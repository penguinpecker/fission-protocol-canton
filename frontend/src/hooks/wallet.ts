import { create } from 'zustand';

interface WalletState {
  party: string | null;
  displayName: string | null;
  connect: (party: string, token: string, displayName?: string) => void;
  disconnect: () => void;
}

export const useWallet = create<WalletState>((set) => ({
  party: localStorage.getItem('fission.party'),
  displayName: localStorage.getItem('fission.displayName'),
  connect: (party, token, displayName) => {
    localStorage.setItem('fission.party', party);
    localStorage.setItem('fission.token', token);
    if (displayName) localStorage.setItem('fission.displayName', displayName);
    set({ party, displayName: displayName ?? party });
  },
  disconnect: () => {
    localStorage.removeItem('fission.party');
    localStorage.removeItem('fission.token');
    localStorage.removeItem('fission.displayName');
    set({ party: null, displayName: null });
  },
}));
