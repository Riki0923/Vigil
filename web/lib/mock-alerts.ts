import type { Alert } from "./types";

export const mockAlerts: Alert[] = [
  {
    id: "mock-3",
    timestamp: new Date(Date.now() - 1000 * 60 * 7).toISOString(),
    severity: "CRITICAL",
    proxyAddress: "0x6844b859AAB02FD82f8F0d802c70A5E4413DD29E",
    implementationAddress: "0xaDF95092a2f528AB67D22335C40F59bF45F2cA41",
    txHash: "0xfdcd2f5326d5b05f8c1b23adf8dce094920ac5944516786516dc61673989ed35",
    isVerified: true,
    hasStorageLayout: true,
    message: "Storage layout diff: 1 moved, 0 removed, 0 added",
    rawData: {
      removedVariables: [],
      addedVariables: [],
      movedVariables: [
        {
          label: "_pausedBalance",
          oldSlot: "5",
          newSlot: "6",
          oldOffset: 0,
          newOffset: 0,
        },
      ],
    },
    analysis: {
      summary: "Slot 5 reassigned from `_pausedBalance` to `adminRole`, creating a storage collision.",
      explanation:
        "The previous implementation stored `_pausedBalance` (mapping(address => uint256)) at slot 5. The upgrade reuses slot 5 for `adminRole` (address). Existing on-chain values for paused balances will be reinterpreted as admin-role pointers, allowing arbitrary unauthorised privilege escalation.",
      recommendation:
        "Subscribers should pause all interactions with this proxy. Protocol team must roll back the upgrade or migrate state.",
      confidence: "high",
    },
  },
  {
    id: "mock-2",
    timestamp: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
    severity: "MEDIUM",
    proxyAddress: "0xF300648Bc0Da37e7a93a378AE9Eb80e156C4894C",
    implementationAddress: "0x5C657Ab54B98800B26F38f8C73DB831fBe5D9c22",
    txHash: "0xe35c2b9060b4dfcda812c97b2c2c60953837433a9dc662af2dfa6cfdd2e89b94",
    isVerified: true,
    hasStorageLayout: true,
    message: "Storage layout diff: 0 moved, 0 removed, 1 added",
    rawData: {
      removedVariables: [],
      movedVariables: [],
      addedVariables: [
        { label: "version", offset: 0, slot: "8", type: "t_uint256" },
      ],
    },
    analysis: {
      summary: "Backwards-compatible upgrade adding one storage variable.",
      explanation:
        "A new `version` uint256 was appended at slot 8. No existing slots were moved or removed. This pattern matches a standard upgrade hygiene addition for on-chain version tracking.",
      recommendation: "No action required. Routine upgrade.",
      confidence: "high",
    },
  },
  {
    id: "mock-1",
    timestamp: new Date(Date.now() - 1000 * 60 * 32).toISOString(),
    severity: "CRITICAL",
    proxyAddress: "0x1234abcd5678ef901234abcd5678ef901234abcd",
    implementationAddress: "0xffff9999eeee8888dddd7777cccc6666bbbb5555",
    txHash: "0x4a8e1d7f2b3c9e6f8a5d2c1b9e7f4a6d3c8b5e2f1a9d7c4b3e2a8f5d1c9b6e3a",
    isVerified: false,
    hasStorageLayout: false,
    message: "Unverified implementation detected",
    rawData: { oldImplAddress: "0xaaaa1111bbbb2222cccc3333dddd4444eeee5555" },
  },
];
