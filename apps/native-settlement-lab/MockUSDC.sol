// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// Local EVM fixture only. Public mint and replaced bytecode are NEVER deployed
// to a real network. This is not Circle's contract or a production token.
contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(bytes32 => bool)) public authorizationState;
    event Transfer(address indexed from, address indexed to, uint256 value);
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    function mint(address owner, uint256 amount) external { balanceOf[owner] += amount; }
    function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes calldata signature) external {
        require(signature.length == 65, "signature length");
        bytes32 r; bytes32 s; uint8 v;
        assembly { r := calldataload(signature.offset) s := calldataload(add(signature.offset,32)) v := byte(0,calldataload(add(signature.offset,64))) }
        transferAuthorization(from,to,value,validAfter,validBefore,nonce,v,r,s);
    }
    function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external {
        transferAuthorization(from,to,value,validAfter,validBefore,nonce,v,r,s);
    }
    function transferAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s) internal {
        require(block.timestamp > validAfter && block.timestamp < validBefore, "authorization time");
        require(!authorizationState[from][nonce], "authorization used");
        bytes32 domain = keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),keccak256("USD Coin"),keccak256("2"),block.chainid,address(this)));
        bytes32 body = keccak256(abi.encode(keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"),from,to,value,validAfter,validBefore,nonce));
        require(from != address(0) && ecrecover(keccak256(abi.encodePacked(hex"1901",domain,body)),v,r,s) == from,"signature invalid");
        require(balanceOf[from] >= value,"insufficient balance");
        authorizationState[from][nonce] = true;
        balanceOf[from] -= value; balanceOf[to] += value;
        emit AuthorizationUsed(from,nonce); emit Transfer(from,to,value);
    }
}
