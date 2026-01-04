
import { User } from "../types";

const USERS_STORAGE_KEY = 'roadmap_users_db_v1';

// Initialize with a default admin if empty
const getStoredUsers = (): User[] => {
  const stored = localStorage.getItem(USERS_STORAGE_KEY);
  if (!stored) {
    return [];
  }
  return JSON.parse(stored);
};

export const authService = {
  login: (username: string, password?: string): User | null => {
    const users = getStoredUsers();
    // Simple check. In production, use bcrypt/argon2 on backend.
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
      return { ...user, role: 'admin' }; // Registered users are admins
    }
    return null;
  },

  register: (username: string, password?: string): { success: boolean; message?: string; user?: User } => {
    if (!username || !password) return { success: false, message: "Missing credentials" };
    
    const users = getStoredUsers();
    if (users.find(u => u.username === username)) {
      return { success: false, message: "Username already exists" };
    }

    const newUser: User = { username, password, role: 'admin' };
    users.push(newUser);
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
    
    return { success: true, user: newUser };
  },

  guestLogin: (): User => {
    return { username: 'Guest', role: 'guest' };
  }
};
