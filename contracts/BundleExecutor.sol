//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.6.12;

pragma experimental ABIEncoderV2;

interface IERC20 {
    event Approval(address indexed owner, address indexed spender, uint value);
    event Transfer(address indexed from, address indexed to, uint value);

    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (uint);
    function balanceOf(address owner) external view returns (uint);
    function allowance(address owner, address spender) external view returns (uint);

    function approve(address spender, uint value) external returns (bool);
    function transfer(address to, uint value) external returns (bool);
    function transferFrom(address from, address to, uint value) external returns (bool);
}

interface IWETH is IERC20 {
    function deposit() external payable;
    function withdraw(uint) external;
}

// This contract simply calls multiple targets sequentially, ensuring WETH balance before and after

contract FlashBotsMultiCall {
    address private immutable owner;
    address private immutable executor;
    IWETH private constant WETH = IWETH(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);

    modifier onlyExecutor() {
        require(msg.sender == executor);
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    constructor(address _executor) public payable {
        owner = msg.sender;
        executor = _executor;
        if (msg.value > 0) {
            WETH.deposit{value: msg.value}();
        }
    }

    receive() external payable {
    }

    function uniswapWeth(uint256 _wethAmountToFirstMarket, uint256 _ethAmountToCoinbase, address[] memory _targets, bytes[] memory _payloads) external onlyExecutor payable {
        // Are the targets and payloads the same length? Otherwise
        // were missing one somewhere and we really messed up
        require (_targets.length == _payloads.length);
        // Store our starting balance of WETH
        uint256 _wethBalanceBefore = WETH.balanceOf(address(this));
        // Optimistically transfer our WETH to the first pair
        // target[0] being our first pair and wethAmount being volume of the trade.
        // You need to send WETH first in Uniswap V2, and then you're able to
        // pull the same amount out.
        WETH.transfer(_targets[0], _wethAmountToFirstMarket);
        for (uint256 i = 0; i < _targets.length; i++) {
          // Call our targets with their respective payloads
          // Our payload is the low level swap function with the specific parameters we computed
          // This is where the swap finally actually happens on the market
            (bool _success, bytes memory _response) = _targets[i].call(_payloads[i]);
            require(_success); _response;
        }

          // Make sure we didn't get rekt -- store our balance of WETH after the swap
        uint256 _wethBalanceAfter = WETH.balanceOf(address(this));
          // Check to make sure our post swap balance is greater than the starting balance.
        require(_wethBalanceAfter > _wethBalanceBefore + _ethAmountToCoinbase);
          // If were not paying anything to the miner, return
        if (_ethAmountToCoinbase == 0) return;

          // If we are paying the miner, make sure we have
          // the ammount in our wallet to actually pay the miner
        uint256 _ethBalance = address(this).balance;
        if (_ethBalance < _ethAmountToCoinbase) {
            WETH.withdraw(_ethAmountToCoinbase - _ethBalance);
        }

        // Through Flashbots bundles and special client MEV-Geth you have the ability to
        // pay the miner it's profit through a smart contract call block.coinbase.transfer
        block.coinbase.transfer(_ethAmountToCoinbase);

        // Because we only pay the miner after we make sure we have performed a profitable
        // arbitrage trade, we only incentivize the miner to include our bundle if we
        // actually paid them.  Meaning any non-profitable swaps would have failed the require
        // and we would not have paid the miner, so they would leave our transaction out.
        // We should always have this block.coinbase.transfer call after all of our conditionals
    }

    function call(address payable _to, uint256 _value, bytes calldata _data) external onlyOwner payable returns (bytes memory) {
        require(_to != address(0));
        (bool _success, bytes memory _result) = _to.call{value: _value}(_data);
        require(_success);
        return _result;
    }
}
