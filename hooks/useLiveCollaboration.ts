
import { useState, useEffect, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { AppState } from '../types';

interface UseLiveCollaborationProps {
  currentState: AppState;
  onRemoteUpdate: (remoteState: AppState) => void;
}

export const useLiveCollaboration = ({ currentState, onRemoteUpdate }: UseLiveCollaborationProps) => {
  const [isConnected, setIsConnected] = useState(false);
  const [roomName, setRoomName] = useState<string | null>(null);
  const [peersCount, setPeersCount] = useState(0);
  
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebrtcProvider | null>(null);
  
  // Track if the current update is coming from remote to prevent loops
  const isRemoteUpdate = useRef(false);

  const connect = useCallback((room: string) => {
    if (!room) return;
    
    // Cleanup existing
    if (providerRef.current) {
      providerRef.current.destroy();
      ydocRef.current?.destroy();
    }

    const doc = new Y.Doc();
    // Using public signaling servers from y-webrtc by default.
    const provider = new WebrtcProvider(room, doc, {
      signaling: ['wss://signaling.yjs.dev', 'wss://y-webrtc-signaling-eu.herokuapp.com', 'wss://y-webrtc-signaling-us.herokuapp.com'],
      password: null
    });

    ydocRef.current = doc;
    providerRef.current = provider;
    setRoomName(room);
    setIsConnected(true);

    // Sync State Logic
    const yMap = doc.getMap('shared-state');

    // Listen for remote changes
    yMap.observeDeep(() => {
      if (isRemoteUpdate.current) return; // Ignore if we caused it
      
      const remoteJsonStr = yMap.get('appState') as string;
      if (remoteJsonStr) {
        try {
          const remoteState = JSON.parse(remoteJsonStr);
          // Flag that we are processing a remote update
          isRemoteUpdate.current = true;
          onRemoteUpdate(remoteState);
          // Reset flag after a short delay
          setTimeout(() => { isRemoteUpdate.current = false; }, 100);
        } catch (e) {
          console.error("Failed to parse remote state", e);
        }
      }
    });

    // Peer Awareness
    provider.awareness.on('change', () => {
      // Count connected states (peers)
      const states = provider.awareness.getStates();
      setPeersCount(states.size);
    });
    
    // Broadcast initial state
    if (!yMap.has('appState')) {
      yMap.set('appState', JSON.stringify(currentState));
    }

  }, [onRemoteUpdate, currentState]);

  const disconnect = useCallback(() => {
    if (providerRef.current) {
      providerRef.current.disconnect();
      providerRef.current.destroy();
    }
    if (ydocRef.current) {
      ydocRef.current.destroy();
    }
    setIsConnected(false);
    setRoomName(null);
    setPeersCount(0);
  }, []);

  // Broadcast local changes
  const broadcast = useCallback((state: AppState) => {
    if (!isConnected || !ydocRef.current || isRemoteUpdate.current) return;

    const yMap = ydocRef.current.getMap('shared-state');
    const newStateStr = JSON.stringify(state);
    
    // Only broadcast if different
    if (yMap.get('appState') !== newStateStr) {
      ydocRef.current.transact(() => {
        yMap.set('appState', newStateStr);
      }, 'local');
    }
  }, [isConnected]);

  return {
    isConnected,
    roomName,
    peersCount,
    connect,
    disconnect,
    broadcast
  };
};
