export default {
  chainDescriptors: {
    143: { name: "Monad", chainType: "l1", hardforkHistory: { prague: { blockNumber: 0 } } },
  },
  networks: {
    local: { type: "edr-simulated", chainType: "l1", chainId: 31337, hardfork: "shanghai" },
    // Read-only mainnet fork for test:fork. Nothing is signed or sent to the real network.
    monadFork: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 143,
      hardfork: "prague",
      forking: {
        url: process.env.MONAD_MAINNET_RPC_URL || "https://rpc.monad.xyz",
        ...(process.env.MONAD_FORK_BLOCK ? { blockNumber: Number(process.env.MONAD_FORK_BLOCK) } : {}),
      },
    },
  },
};
