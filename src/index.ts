import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import { Contract, providers, Wallet } from "ethers";
import { BUNDLE_EXECUTOR_ABI } from "./abi";
import { UniswappyV2EthPair } from "./UniswappyV2EthPair";
import { FACTORY_ADDRESSES } from "./addresses";
import { Arbitrage } from "./Arbitrage";
import { get } from "https"
import { getDefaultRelaySigningKey } from "./utils";

// We need a Node, which is our Ethereum RPC Url
const ETHEREUM_RPC_URL = process.env.ETHEREUM_RPC_URL || "http://127.0.0.1:8545"

// A private key from your wallet.  You can use the utils to generate a random one
// but it won't build trust with Flashbots because you'll use a new one next time.
// It's a bad habit though.
const PRIVATE_KEY = process.env.PRIVATE_KEY || ""

// You need to deploy a contract before you're able to actually use this. Specify
// that contract address here.
const BUNDLE_EXECUTOR_ADDRESS = process.env.BUNDLE_EXECUTOR_ADDRESS || ""

// You need another private key to identify yourself to the Flashbots relay.  It can be anything
// and doesn't need to be what you're executing transactions with.  It just needs to be a private
// key to sign your bundles with.
const FLASHBOTS_RELAY_SIGNING_KEY = process.env.FLASHBOTS_RELAY_SIGNING_KEY || getDefaultRelaySigningKey();

// How much of your profits are you paying to the miner.  
const MINER_REWARD_PERCENTAGE = parseInt(process.env.MINER_REWARD_PERCENTAGE || "80")

if (PRIVATE_KEY === "") {
  console.warn("Must provide PRIVATE_KEY environment variable")
  process.exit(1)
}
if (BUNDLE_EXECUTOR_ADDRESS === "") {
  console.warn("Must provide BUNDLE_EXECUTOR_ADDRESS environment variable. Please see README.md")
  process.exit(1)
}

if (FLASHBOTS_RELAY_SIGNING_KEY === "") {
  console.warn("Must provide FLASHBOTS_RELAY_SIGNING_KEY. Please see https://github.com/flashbots/pm/blob/main/guides/searcher-onboarding.md")
  process.exit(1)
}

const HEALTHCHECK_URL = process.env.HEALTHCHECK_URL || ""

// We start by setting up our provider, which is needed to pull data 
// off of the blockchain
const provider = new providers.StaticJsonRpcProvider(ETHEREUM_RPC_URL);

// We construct a wallet to sign our arbitrage transactions
const arbitrageSigningWallet = new Wallet(PRIVATE_KEY);
// We construct another wallet to sign our bundles to Flashbots
const flashbotsRelaySigningWallet = new Wallet(FLASHBOTS_RELAY_SIGNING_KEY);

function healthcheck() {
  if (HEALTHCHECK_URL === "") {
    return
  }
  get(HEALTHCHECK_URL).on('error', console.error);
}

async function main() {
  console.log("Searcher Wallet Address: " + await arbitrageSigningWallet.getAddress())
  console.log("Flashbots Relay Signing Wallet Address: " + await flashbotsRelaySigningWallet.getAddress())
  // We start by instantiating a FlashbotsBundleProvider which we use to 
  // actually create bundles and send them to the Flashbots relay
  const flashbotsProvider = await FlashbotsBundleProvider.create(provider, flashbotsRelaySigningWallet);
  const arbitrage = new Arbitrage(
    arbitrageSigningWallet,
    flashbotsProvider,
    new Contract(BUNDLE_EXECUTOR_ADDRESS, BUNDLE_EXECUTOR_ABI, provider) )

  // All of our initial start up is contained here. Batch requesting pairs from the factory addresses, calling
  // for the pairs reserves and filtering out pairs with <1 ETH in their balance.
  const markets = await UniswappyV2EthPair.getUniswapMarketsByToken(provider, FACTORY_ADDRESSES);
  
  // Register an event listener to process every time a block event fires.
  provider.on('block', async (blockNumber) => {
    // On each new block we need to update the state of reserves
    await UniswappyV2EthPair.updateReserves(provider, markets.allMarketPairs);
    const bestCrossedMarkets = await arbitrage.evaluateMarkets(markets.marketsByToken);
    if (bestCrossedMarkets.length === 0) {
      console.log("No crossed markets")
      return
    }
    bestCrossedMarkets.forEach(Arbitrage.printCrossedMarket);
    arbitrage.takeCrossedMarkets(bestCrossedMarkets, blockNumber, MINER_REWARD_PERCENTAGE).then(healthcheck).catch(console.error)
  })
}

main();
