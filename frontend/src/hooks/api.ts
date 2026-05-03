import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useWallet } from "./wallet";

export const useAssets = () =>
  useQuery({ queryKey: ["assets"], queryFn: api.listAssets, refetchInterval: 8_000 });

export const useMarkets = () =>
  useQuery({ queryKey: ["markets"], queryFn: api.listMarkets, refetchInterval: 8_000 });

export const usePortfolio = () => {
  const token = useWallet((s) => s.token);
  return useQuery({
    queryKey: ["portfolio", token],
    queryFn: () => api.portfolio(token!),
    enabled: !!token,
    refetchInterval: 8_000,
  });
};

export const useMint = () => {
  const token = useWallet((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { marketAssetCode: string; marketMaturityIso: string; amount: string }) =>
      api.mint(token!, args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["markets"] });
    },
  });
};

export const useSwap = () => {
  const token = useWallet((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      marketAssetCode: string;
      marketMaturityIso: string;
      kind: "SyToPt" | "PtToSy";
      amountIn: string;
      minAmountOut: string;
    }) => api.swap(token!, args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["markets"] });
    },
  });
};

export const useClaim = () => {
  const token = useWallet((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ytContractId: string) => api.claim(token!, ytContractId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portfolio"] }),
  });
};
