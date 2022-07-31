export const UNISWAP_LOOKUP_CONTRACT_ADDRESS = '0x5EF1009b9FCD4fec3094a5564047e190D72Bd511'
export const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
export const SUSHISWAP_FACTORY_ADDRESS = '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac';
export const UNISWAP_FACTORY_ADDRESS = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
export const CRO_FACTORY_ADDRESS = "0x9DEB29c9a4c7A88a3C0257393b7f3335338D9A9D";
export const ZEUS_FACTORY_ADDRESS = "0xbdda21dd8da31d5bee0c9bb886c044ebb9b8906a";
export const LUA_FACTORY_ADDRESS = "0x0388c1e0f210abae597b7de712b9510c6c36c857";

// These are all UniSwap V2 forks
// The factory addresses are the contracts that actually deploy the 
// pair contracts such as ETH/USDC.  We need to call getPair on the 
// factory contracts to find the contract addresses of the pairs that
// have been deployed by it.
export const FACTORY_ADDRESSES = [
  CRO_FACTORY_ADDRESS,
  ZEUS_FACTORY_ADDRESS,
  LUA_FACTORY_ADDRESS,
  SUSHISWAP_FACTORY_ADDRESS,
  UNISWAP_FACTORY_ADDRESS,
]
