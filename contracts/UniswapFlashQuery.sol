//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.6.12;

pragma experimental ABIEncoderV2;

interface IUniswapV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
}

abstract contract UniswapV2Factory  {
    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;
    function allPairsLength() external view virtual returns (uint);
}

// In order to quickly load up data from Uniswap-like market, this contract allows easy iteration with a single eth_call
contract FlashBotsUniswapQuery {
    // Expects to be called with an array of different addresses.  Because its typed as a UniswapV2Pair 
    // we can call the contract functions on it
    function getReservesByPairs(IUniswapV2Pair[] calldata _pairs) external view returns (uint256[3][] memory) {
        // Return the data here in batches because thats faster
        // than doing 1 request per address.  We create this array that is the length
        // of the number of pairs.
        uint256[3][] memory result = new uint256[3][](_pairs.length);
        for (uint i = 0; i < _pairs.length; i++) {
          // We call getReserves which shows the current quanity of the token
          // in the contract.  These can be used to figure out the price
          // of different assets.
          // The first reserve, the second reserve, and the timestamp are destructured here
          // in the response.
            (result[i][0], result[i][1], result[i][2]) = _pairs[i].getReserves();
        }
        // We return the reserves of all of our pairs across all of our
        // factory addresses.
        return result;
    }

    function getPairsByIndexRange(UniswapV2Factory _uniswapFactory, uint256 _start, uint256 _stop) external view returns (address[3][] memory)  {
        uint256 _allPairsLength = _uniswapFactory.allPairsLength();
        if (_stop > _allPairsLength) {
            _stop = _allPairsLength;
        }
        require(_stop >= _start, "start cannot be higher than stop");
        uint256 _qty = _stop - _start;
        address[3][] memory result = new address[3][](_qty);
        for (uint i = 0; i < _qty; i++) {
          // We wrap this returned pair in an interface so that we know we're working
          // with a pair
            IUniswapV2Pair _uniswapPair = IUniswapV2Pair(_uniswapFactory.allPairs(_start + i));
            // With the type defined, we can now call it's functions.  
            // This will return the address of one side of the pair - ie ETH
            result[i][0] = _uniswapPair.token0();
            // This will return the address of the other side of the pair - ie USDC
            result[i][1] = _uniswapPair.token1();
            // This is the address of the pair itself
            result[i][2] = address(_uniswapPair);
        }
        // This returns us all of the pairs, as well as the tokens within those pairs
        // There's 50,000+ pairs
        return result;
    }
}
