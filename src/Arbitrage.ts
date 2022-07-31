import * as _ from "lodash";
import { BigNumber, Contract, PopulatedTransaction, Wallet } from "ethers";
import { FlashbotsBundleProvider, FlashbotsTransaction, SimulationResponse } from "@flashbots/ethers-provider-bundle";
import { WETH_ADDRESS } from "./addresses";
import { EthMarket, MultipleCallData } from "./EthMarket";
import { ETHER, bigNumberToDecimal } from "./utils";

export interface CrossedMarketDetails {
  profit: BigNumber,
  volume: BigNumber,
  tokenAddress: string,
  buyFromMarket: EthMarket,
  sellToMarket: EthMarket,
}

export interface PricedMarket {
    ethMarket: EthMarket;
    buyTokenPrice: BigNumber;
    sellTokenPrice: BigNumber;
}

export interface BundledTransaction {
  signer: Wallet,
  transaction: PopulatedTransaction,
}

export type MarketsByToken = { [tokenAddress: string]: EthMarket[] }

// TODO: implement binary search (assuming linear/exponential global maximum profitability)
const TEST_VOLUMES = [
  ETHER.div(100),
  ETHER.div(10),
  ETHER.div(6),
  ETHER.div(4),
  ETHER.div(2),
  ETHER.div(1),
  ETHER.mul(2),
  ETHER.mul(5),
  ETHER.mul(10),
]

export function getBestCrossedMarket(crossedMarkets: EthMarket[][], tokenAddress: string): CrossedMarketDetails | undefined {
  let bestCrossedMarket: CrossedMarketDetails | undefined = undefined;
  for (const crossedMarket of crossedMarkets) {
    const sellToMarket = crossedMarket[0]
    const buyFromMarket = crossedMarket[1]
    // For each size from TEST_VOLUMES, how much profit
    // would we make buying from one market and selling to another.
    for (const size of TEST_VOLUMES) {
      const tokensOutFromBuyingSize = buyFromMarket.getTokensOut(WETH_ADDRESS, tokenAddress, size);
      const proceedsFromSellingTokens = sellToMarket.getTokensOut(tokenAddress, WETH_ADDRESS, tokensOutFromBuyingSize)
      const profit = proceedsFromSellingTokens.sub(size);
      // If we don't already have a bestMarket and our profit is greater than the last size
      if (bestCrossedMarket !== undefined && profit.lt(bestCrossedMarket.profit)) {
        // If the next size up lost value, meet halfway. TODO: replace with real binary search
        // This is a naive way of optimizing the best size available to trade according to bertcmiller
        const trySize = size.add(bestCrossedMarket.volume).div(2)
        const tryTokensOutFromBuyingSize = buyFromMarket.getTokensOut(WETH_ADDRESS, tokenAddress, trySize);
        const tryProceedsFromSellingTokens = sellToMarket.getTokensOut(tokenAddress, WETH_ADDRESS, tryTokensOutFromBuyingSize)
        const tryProfit = tryProceedsFromSellingTokens.sub(trySize);
        if (tryProfit.gt(bestCrossedMarket.profit)) {
          bestCrossedMarket = {
            volume: trySize,
            profit: tryProfit,
            tokenAddress,
            sellToMarket,
            buyFromMarket
          }
        }
        break;
      }
      bestCrossedMarket = {
        volume: size,
        profit: profit,
        tokenAddress,
        sellToMarket,
        buyFromMarket
      }
    }
  }
  return bestCrossedMarket;
}

export class Arbitrage {
  // Send bundles to Flashbots using this
  private flashbotsProvider: FlashbotsBundleProvider;
  // Contract we're interacting with
  private bundleExecutorContract: Contract;
  // Wallet that is actaully signing the transaction
  private executorWallet: Wallet;

  constructor(executorWallet: Wallet, flashbotsProvider: FlashbotsBundleProvider, bundleExecutorContract: Contract) {
    this.executorWallet = executorWallet;
    this.flashbotsProvider = flashbotsProvider;
    this.bundleExecutorContract = bundleExecutorContract;
  }

  static printCrossedMarket(crossedMarket: CrossedMarketDetails): void {
    const buyTokens = crossedMarket.buyFromMarket.tokens
    const sellTokens = crossedMarket.sellToMarket.tokens
    console.log(
      `Profit: ${bigNumberToDecimal(crossedMarket.profit)} Volume: ${bigNumberToDecimal(crossedMarket.volume)}\n` +
      `${crossedMarket.buyFromMarket.protocol} (${crossedMarket.buyFromMarket.marketAddress})\n` +
      `  ${buyTokens[0]} => ${buyTokens[1]}\n` +
      `${crossedMarket.sellToMarket.protocol} (${crossedMarket.sellToMarket.marketAddress})\n` +
      `  ${sellTokens[0]} => ${sellTokens[1]}\n` +
      `\n`
    )
  }


  async evaluateMarkets(marketsByToken: MarketsByToken): Promise<CrossedMarketDetails[]> {
    const bestCrossedMarkets: CrossedMarketDetails[] = [];

    for (const tokenAddress in marketsByToken) {
      const markets: EthMarket[] = marketsByToken[tokenAddress]
      // PricedMarkets will tell us the buy/sell price across each individual market,
      // making it easier to compare them and find arbitrage later on
      const pricedMarkets: PricedMarket[] = _.map(markets, (ethMarket: EthMarket) => {
        // Trading against ETH, what can we buy/sell this token at
        return {
          ethMarket: ethMarket,
          buyTokenPrice: ethMarket.getTokensIn(tokenAddress, WETH_ADDRESS, ETHER.div(100)),
          sellTokenPrice: ethMarket.getTokensOut(WETH_ADDRESS, tokenAddress, ETHER.div(100)),
        }
      });

      const crossedMarkets: EthMarket[][] = [];
      // For each pricedMarket, check to see if the sell price
      // of any OTHER pricedMarkets is > buyTokenPrice of this particular pricedMarket
      // Ie is it cheaper to buy them on UniSwap and sell them on SushiSwap
      for (const pricedMarket of pricedMarkets) {
        _.forEach(pricedMarkets, pm => {
          if (pm.sellTokenPrice.gt(pricedMarket.buyTokenPrice)) {
            // We have an arbitrage opportunity, and we save it
            crossedMarkets.push([pricedMarket.ethMarket, pm.ethMarket])
          }
        })
      }

      // Now that we have some arbitrage opportunities, let's find the best ones
      const bestCrossedMarket: CrossedMarketDetails | undefined = getBestCrossedMarket(crossedMarkets, tokenAddress);
      if (bestCrossedMarket !== undefined && bestCrossedMarket.profit.gt(ETHER.div(1000))) {
        bestCrossedMarkets.push(bestCrossedMarket)
      }
    }
    bestCrossedMarkets.sort((a, b) => a.profit.lt(b.profit) ? 1 : a.profit.gt(b.profit) ? -1 : 0)
    return bestCrossedMarkets
  }

  // TODO: take more than 1
  async takeCrossedMarkets(bestCrossedMarkets: CrossedMarketDetails[], blockNumber: number, minerRewardPercentage: number): Promise<void> {
    for (const bestCrossedMarket of bestCrossedMarkets) {

      console.log("Send this much WETH", bestCrossedMarket.volume.toString(), "get this much profit", bestCrossedMarket.profit.toString())
      const buyCalls: MultipleCallData = await bestCrossedMarket.buyFromMarket.sellTokensToNextMarket(WETH_ADDRESS, bestCrossedMarket.volume, bestCrossedMarket.sellToMarket);
      const inter: BigNumber = bestCrossedMarket.buyFromMarket.getTokensOut(WETH_ADDRESS, bestCrossedMarket.tokenAddress, bestCrossedMarket.volume)
      const sellCallData: string = await bestCrossedMarket.sellToMarket.sellTokens(bestCrossedMarket.tokenAddress, inter, this.bundleExecutorContract.address);

      const targets: string[] = [...buyCalls.targets, bestCrossedMarket.sellToMarket.marketAddress]
      // Another trick when interacting with these, you don't always implement the function
      // that you want to interact with directly on chain.  Instead, you generate the bytecode
      // for what interacting with a function with a certain set of parameters would look like. 
      // You only pass that bytecode in on chain.  payloads is an example of this trick.
      const payloads: string[] = [...buyCalls.data, sellCallData]
      // Using a targets/payload is uniquely enabled by Flashbots.  Because using Flashbots you
      // target blocks and always fall at the head of the block, you have a massive optimization
      // enabling you to make calculations off chain and submit transactions more quickly.
      // This reduces gas costs enabling more profits.
      console.log({targets, payloads})
      const minerReward: BigNumber = bestCrossedMarket.profit.mul(minerRewardPercentage).div(100);
      // We go ahead and populate the details of our transaction
      const transaction: PopulatedTransaction = await this.bundleExecutorContract.populateTransaction.uniswapWeth(bestCrossedMarket.volume, minerReward, targets, payloads, {
        gasPrice: BigNumber.from(0),
        gasLimit: BigNumber.from(1000000),
      });

      try {
        // Here we estimate what the gas of our transaction will be.
        // If for some reason we fail to estimate, it's not worth the risk
        // and we just throw away the transaction
        const estimateGas: BigNumber = await this.bundleExecutorContract.provider.estimateGas(
          {
            ...transaction,
            from: this.executorWallet.address
          })
          // Another check in case gas is very high we don't get rekt
        if (estimateGas.gt(1400000)) {
          console.log("EstimateGas succeeded, but suspiciously large: " + estimateGas.toString())
          continue
        }
        transaction.gasLimit = estimateGas.mul(2)
      } catch (e) {
        console.warn(`Estimate gas failure for ${JSON.stringify(bestCrossedMarket)}`)
        continue
      }

      // If our gas estimate succeeds, we go on to create a Flashbots bundle.
      // The individual transactions within a bundle are executed in the order
      // that they are bundled, and also are all or nothing in their execution.
      const bundledTransactions: BundledTransaction[] = [
        {
          signer: this.executorWallet,
          transaction: transaction
        }
      ];

      // Another example is having a signedTransaction pulled out of the mempool and included as the first transaction
      // and then a follow up bundle executed immediately after.
      // For example an oracle update.  You're trying to back run and be the first to liquidate 
      // someone else.  So you put the signedTransaction in your bundle and then the follow up
      // is liquidating the oracle update.
      // const bundledTransactions: BundledTransaction[] = [
      //   {
      //     signedTransaction: someSignedTransaction,
      //   },
      //   {
      //     signer: this.executorWallet,
      //     transaction: transaction
      //   }
      // ];
      console.log(bundledTransactions)
      
      // Flashbots takes signed bundles, so we need to sign it with a private key to authenticate it.
      const signedBundle: string[] = await this.flashbotsProvider.signBundle(bundledTransactions)

      // We simulate the bundle to the Flashbots relay to make sure that we're not sending junk
      // The Flashbots relay will return the simulation.  How much gas it used, errors, how much it paid
      // to the miner etc
      const simulation: SimulationResponse = await this.flashbotsProvider.simulate(signedBundle, blockNumber + 1 )
      
      // If there's an error in the simulated bundle, then we short circuit
      if ("error" in simulation || simulation.firstRevert !== undefined) {
        console.log(`Simulation Error on token ${bestCrossedMarket.tokenAddress}, skipping`)
        continue
      }
      console.log(`Submitting bundle, profit sent to miner: ${bigNumberToDecimal(simulation.coinbaseDiff)}, effective gas price: ${bigNumberToDecimal(simulation.coinbaseDiff.div(simulation.totalGasUsed), 9)} GWEI`)

      // Finally send the profitable bundle to Flashbots.
      // We're sending our bundle two blocks into the future. Sometimes miners mine blocks very quickly
      // and if a block is mined in a second you want your bundle to be there and be valid for two blocks
      // into the future.  
      const bundlePromises: Promise<FlashbotsTransaction>[] =  _.map([blockNumber + 1, blockNumber + 2], targetBlockNumber =>
        this.flashbotsProvider.sendRawBundle(
          signedBundle,
          targetBlockNumber
        ))
      await Promise.all(bundlePromises)
      return
    }
    throw new Error("No arbitrage submitted to relay")
  }
}
