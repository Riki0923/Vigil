// Minimal ABIs for ENS contracts on Ethereum Sepolia.
// Canonical addresses: https://docs.ens.domains/learn/deployments

export const ENS_REGISTRY_ABI = [
  "function resolver(bytes32 node) view returns (address)",
  "function owner(bytes32 node) view returns (address)",
] as const;

export const ENS_RESOLVER_ABI = [
  "function addr(bytes32 node) view returns (address)",
  "function addr(bytes32 node, uint256 coinType) view returns (bytes)",
  "function text(bytes32 node, string key) view returns (string)",
  "function name(bytes32 node) view returns (string)",
  "function setAddr(bytes32 node, uint256 coinType, bytes a)",
  "function setText(bytes32 node, string key, string value)",
] as const;

// NameWrapper, used to create/manage subnames programmatically once vigil.eth is wrapped.
// `setSubnodeRecord` creates a subname (or updates one), assigning owner + resolver + ttl.
export const NAME_WRAPPER_ABI = [
  "function setSubnodeRecord(bytes32 parentNode, string label, address owner, address resolver, uint64 ttl, uint32 fuses, uint64 expiry) returns (bytes32)",
  "function ownerOf(uint256 id) view returns (address)",
] as const;

// L2 Reverse Registrar (ENSIP-19), sets the primary name for an address on L2.
// Verified against ensdomains/ens-contracts deployments/baseSepolia/L2ReverseRegistrar.json
// (Base Sepolia: 0x00000BeEF055f7934784D6d81b6BC86665630dbA, Base mainnet: 0x0000000000D8e504002cC26E3Ec46D81971C1664).
//
// Three usage patterns:
//   - setName(name), caller sets their own reverse name (msg.sender)
//   - setNameForAddrWithSignature, set reverse for an EOA via off-chain signature from that EOA
//   - setNameForOwnableWithSignature, set reverse for an Ownable contract (e.g. our UUPS proxy)
//     by submitting an off-chain signature from the contract's `owner()`
export const L2_REVERSE_REGISTRAR_ABI = [
  "function setName(string name) returns (bytes32)",
  "function setNameForAddrWithSignature(address addr, uint256 signatureExpiry, string name, uint256[] coinTypes, bytes signature) returns (bytes32)",
  "function setNameForOwnableWithSignature(address contractAddr, address owner, uint256 signatureExpiry, string name, uint256[] coinTypes, bytes signature) returns (bytes32)",
] as const;
