import type { Alert } from "./types";

export const mockAlerts: Alert[] = [
  {
    id: "mock-3",
    timestamp: new Date(Date.now() - 1000 * 60 * 7).toISOString(),
    severity: "CRITICAL",
    proxyAddress: "0x6844b859AAB02FD82f8F0d802c70A5E4413DD29E",
    implementationAddress: "0xaDF95092a2f528AB67D22335C40F59bF45F2cA41",
    txHash: "0xfdcd2f5326d5b05f8c1b23adf8dce094920ac5944516786516dc61673989ed35",
    blockNumber: 45738720,
    isVerified: true,
    hasStorageLayout: true,
    message:
      "Storage: 1 moved, 0 removed, 0 added | ABI: 1 added, 1 removed, 0 modified | Match: exact",
    rawData: {
      storageDiff: {
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
      abiDiff: {
        addedFunctions: [
          {
            type: "function",
            name: "withdraw",
            inputs: [{ name: "amount", type: "uint256" }],
            outputs: [],
            stateMutability: "nonpayable",
          },
        ],
        removedFunctions: [
          {
            type: "function",
            name: "pause",
            inputs: [],
            outputs: [],
            stateMutability: "nonpayable",
          },
        ],
        modifiedFunctions: [],
      },
      functionRiskFlags: [
        {
          level: "CRITICAL",
          message: 'Sensitive function "withdraw" (withdraw(uint256)) was added or modified',
        },
        { level: "HIGH", message: "1 function(s) removed: pause" },
      ],
      matchType: "exact",
      contractMeta: {
        matchType: "exact",
        creationTxHash: "0x9ab1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1",
        compilerVersion: "0.8.20+commit.a1b79de6",
      },
      natSpec: {
        title: "DemoVault",
        notice: "A vault contract that holds user deposits.",
        details: null,
        methods: {
          "withdraw(uint256)": { notice: "Withdraw amount from user balance" },
        },
      },
    },
    analysis: {
      summary: "Slot 5 reassigned creating storage collision; sensitive `withdraw` function added.",
      explanation:
        "The previous `_pausedBalance` mapping at slot 5 has been moved to slot 6 while a new `withdraw(uint256)` function was added at the same time. Existing values at slot 5 will be reinterpreted by the new layout, and the sensitive added function provides a path to drain affected balances.",
      recommendation:
        "Halt subscriber-side automation. Protocol team must roll back or migrate state before re-enabling.",
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
    blockNumber: 45738650,
    isVerified: true,
    hasStorageLayout: true,
    message:
      "Storage: 0 moved, 0 removed, 1 added | ABI: 1 added, 0 removed, 0 modified | Match: exact",
    rawData: {
      storageDiff: {
        removedVariables: [],
        movedVariables: [],
        addedVariables: [
          { label: "version", offset: 0, slot: "8", type: "t_uint256" },
        ],
      },
      abiDiff: {
        addedFunctions: [
          {
            type: "function",
            name: "getVersion",
            inputs: [],
            outputs: [{ name: "", type: "uint256" }],
            stateMutability: "view",
          },
        ],
        removedFunctions: [],
        modifiedFunctions: [],
      },
      functionRiskFlags: [
        { level: "MEDIUM", message: "1 function(s) added: getVersion" },
      ],
      matchType: "exact",
      contractMeta: {
        matchType: "exact",
        creationTxHash: null,
        compilerVersion: "0.8.20+commit.a1b79de6",
      },
      natSpec: null,
    },
    analysis: {
      summary: "Backwards-compatible upgrade adding one storage variable and a view function.",
      explanation:
        "A new `version` uint256 was appended at slot 8 with a matching `getVersion()` view. No existing slots were moved or removed.",
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
    blockNumber: 45738400,
    isVerified: false,
    hasStorageLayout: false,
    message:
      "HIGH SIMILARITY to known contract — possible clone (2 match(es) above 0.9 score)",
    rawData: {
      oldImplAddress: "0xaaaa1111bbbb2222cccc3333dddd4444eeee5555",
      similarContracts: [
        {
          address: "0xdeadbeef1111222233334444555566667777aaaa",
          chainId: 1,
          similarity: 0.97,
        },
        {
          address: "0xbadcafe9999888877776666555544443333bbbb",
          chainId: 8453,
          similarity: 0.92,
        },
        {
          address: "0xcafebabe1234567890abcdef1234567890123456",
          chainId: 8453,
          similarity: 0.81,
        },
      ],
    },
  },
];
