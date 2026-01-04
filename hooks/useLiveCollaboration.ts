import { useState, useRef, useCallback, useEffect } from 'react';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { Project, WorkLog, Collaborator } from '../types';

interface SharedData {
  projects: Project[];
  logs: Record<string, Record<string, WorkLog[]>>;
}

interface UserInfo {
  username: string;
  color: string;
}

interface UseLiveCollaborationProps {
  onRemoteUpdate: (data: SharedData) => void;
  onRoomClosed?: () => void; // Callback when host closes room
}

export const useLiveCollaboration = ({ onRemoteUpdate, onRoomClosed }: UseLiveCollaborationProps) => {
  const [isConnected, setIsConnected] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<string | null>(null);
  const [peersCount, setPeersCount] = useState(0);
  const [isHost, setIsHost] = useState(false);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]); // Added state for collaborators
  
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebrtcProvider | null>(null);
  
  const connect = useCallback(async (
    room: string, 
    mode: 'create' | 'join', 
    initialData?: { projects: Project[], logs: Record<string, Record<string, WorkLog[]>> },
    userInfo?: UserInfo // Added userInfo
  ): Promise<boolean> => {
    if (!room) return false;
    
    // Cleanup existing
    if (providerRef.current) {
      providerRef.current.destroy();
      ydocRef.current?.destroy();
      setPeersCount(0);
      setCollaborators([]);
    }

    const doc = new Y.Doc();
    const amHost = mode === 'create';
    setIsHost(amHost);

    // Use multiple public signaling servers to improve connection reliability
    const provider = new WebrtcProvider(room, doc, {
      signaling: [
        'wss://signaling.yjs.dev',
        'wss://y-webrtc-signaling-eu.herokuapp.com',
        'wss://y-webrtc-signaling-us.herokuapp.com'
      ],
      password: null,
      maxConns: 20 + Math.floor(Math.random() * 15), 
      filterBcConns: true,
      peerOpts: {}
    });

    // Helper to read data and update UI
    const readAndNotify = () => {
      const yMap = doc.getMap('roadmap-data');
      const projectsJson = yMap.get('projects') as string;
      const logsJson = yMap.get('logs') as string;

      if (projectsJson && logsJson) {
        try {
          const projects = JSON.parse(projectsJson);
          const logs = JSON.parse(logsJson);
          
          onRemoteUpdate({ projects, logs });
        } catch (e) {
          console.error("Failed to parse remote state", e);
        }
      }
    };

    // Setup logic common to success
    const setupSuccess = () => {
      ydocRef.current = doc;
      providerRef.current = provider;
      setCurrentRoom(room);
      setIsConnected(true);

      // Initialize local presence
      if (userInfo) {
        provider.awareness.setLocalStateField('user', {
          username: userInfo.username,
          color: userInfo.color,
          action: 'Joined',
          clientId: provider.awareness.clientID
        });
      }

      const yMap = doc.getMap('roadmap-data');
      const metaMap = doc.getMap('room-metadata');

      // 0. Seed Data if Creator
      if (amHost) {
        doc.transact(() => {
          // Set Room Status to OPEN
          metaMap.set('status', 'open');

          if (initialData) {
            const newProjectsStr = JSON.stringify(initialData.projects);
            const newLogsStr = JSON.stringify(initialData.logs);
            
            if (yMap.get('projects') !== newProjectsStr) {
               yMap.set('projects', newProjectsStr);
            }
            if (yMap.get('logs') !== newLogsStr) {
               yMap.set('logs', newLogsStr);
            }
          }
        }, 'local');
      } else {
        // GUEST: Force an immediate read. 
        setTimeout(() => {
          readAndNotify();
        }, 500);
      }

      // 1. Listen for remote data changes
      yMap.observeDeep((events, transaction) => {
        if (transaction.origin === 'local') return; 
        readAndNotify();
      });

      // 2. Listen for Room Status (Host closing room)
      metaMap.observe(() => {
        const status = metaMap.get('status') as string;
        if (status === 'closed' && !amHost) {
          // Host has closed the room
          if (onRoomClosed) onRoomClosed();
          
          // Force disconnect locally
          if (provider) {
             provider.disconnect();
             provider.destroy();
          }
          if (doc) doc.destroy();
          setIsConnected(false);
          setCurrentRoom(null);
          setPeersCount(0);
          setCollaborators([]);
        }
      });

      // 3. Awareness / Presence Logic
      const handleAwarenessChange = () => {
        const states = provider.awareness.getStates();
        setPeersCount(Math.max(0, states.size - 1));
        
        const currentCollaborators: Collaborator[] = [];
        states.forEach((state: any, clientID: number) => {
          // Exclude self from the collaborators list generally used for "others"
          if (clientID !== provider.awareness.clientID && state.user) {
            currentCollaborators.push({
              clientId: clientID,
              username: state.user.username || 'Anonymous',
              color: state.user.color || '#ccc',
              action: state.user.action || 'Idle',
              target: state.user.target,
              targetId: state.user.targetId
            });
          }
        });
        setCollaborators(currentCollaborators);
      };
      
      provider.awareness.on('change', handleAwarenessChange);
    };

    if (mode === 'create') {
      setupSuccess();
      return true;
    }

    // Join Mode: Wait for peers to confirm room exists
    return new Promise((resolve) => {
       let foundPeer = false;
       let checkInterval: any = null;

       const cleanupVerification = () => {
          if (checkInterval) clearInterval(checkInterval);
       };

       checkInterval = setInterval(() => {
          if (provider.awareness.getStates().size > 1) {
             foundPeer = true;
             cleanupVerification();
             setupSuccess();
             resolve(true);
          }
       }, 500);

       setTimeout(() => {
         if (!foundPeer) {
           cleanupVerification();
           provider.disconnect();
           provider.destroy();
           doc.destroy();
           resolve(false);
         }
       }, 10000);
    });

  }, [onRemoteUpdate, onRoomClosed]);

  const disconnect = useCallback(async () => {
    // If Host, broadcast 'closed' status before destroying
    if (isHost && ydocRef.current) {
      const metaMap = ydocRef.current.getMap('room-metadata');
      metaMap.set('status', 'closed');
      
      // Give it a moment to propagate to peers
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    if (providerRef.current) {
      providerRef.current.disconnect();
      providerRef.current.destroy();
    }
    if (ydocRef.current) {
      ydocRef.current.destroy();
    }
    setIsConnected(false);
    setCurrentRoom(null);
    setPeersCount(0);
    setCollaborators([]);
    setIsHost(false);
  }, [isHost]);

  const broadcast = useCallback((projects: Project[], logs: Record<string, Record<string, WorkLog[]>>) => {
    if (!ydocRef.current) return;

    const yMap = ydocRef.current.getMap('roadmap-data');
    
    const newProjectsStr = JSON.stringify(projects);
    const newLogsStr = JSON.stringify(logs);
    
    ydocRef.current.transact(() => {
      if (yMap.get('projects') !== newProjectsStr) {
         yMap.set('projects', newProjectsStr);
      }
      if (yMap.get('logs') !== newLogsStr) {
         yMap.set('logs', newLogsStr);
      }
    }, 'local');
  }, []);

  const updatePresence = useCallback((presence: { action: string, target?: string, targetId?: string }) => {
    if (providerRef.current) {
      const current = providerRef.current.awareness.getLocalState();
      if (current && current.user) {
        providerRef.current.awareness.setLocalStateField('user', {
          ...current.user,
          ...presence
        });
      }
    }
  }, []);

  return {
    isConnected,
    currentRoom,
    peersCount,
    collaborators, // Exported
    isHost,
    connect,
    disconnect,
    broadcast,
    updatePresence // Exported
  };
};