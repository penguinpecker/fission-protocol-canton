import { create } from "zustand";

interface WalletState {
  party: string | null;
  token: string | null;
  displayName: string | null;
  connect: (party: string, token: string, displayName?: string) => void;
  disconnect: () => void;
}

export const useWallet = create<WalletState>((set) => ({
  party: typeof localStorage !== "undefined" ? localStorage.getItem("fission.party") : null,
  token: typeof localStorage !== "undefined" ? localStorage.getItem("fission.token") : null,
  displayName: typeof localStorage !== "undefined" ? localStorage.getItem("fission.displayName") : null,
  connect: (party, token, displayName) => {
    localStorage.setItem("fission.party", party);
    localStorage.setItem("fission.token", token);
    if (displayName) localStorage.setItem("fission.displayName", displayName);
    set({ party, token, displayName: displayName ?? party });
  },
  disconnect: () => {
    localStorage.removeItem("fission.party");
    localStorage.removeItem("fission.token");
    localStorage.removeItem("fission.displayName");
    set({ party: null, token: null, displayName: null });
  },
}));
