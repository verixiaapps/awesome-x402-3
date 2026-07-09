#!/usr/bin/env tsx

console.log("🚀 INITIALIZING SCRIPT RUN...");

import { ethers } from 'ethers';
import { appendFileSync, readFileSync } from 'fs';
import { join } from 'path';

// Base L2 Configuration
const BASE_RPC_URL = 'https://mainnet.base.org';
const BASE_USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32d4f71b54bda02913".toLowerCase();
const BLOCKS_TO_SCAN = 500;

// Standard ERC-20 Transfer event signature
const TRANSFER_EVENT_SIGNATURE = 'Transfer(address,address,uint256)';

interface TransferEvent {
  from: string;
  to: string;
  value: bigint;
  blockNumber: number;
  transactionHash: string;
}

class BaseSignalFinder {
  private provider: ethers.JsonRpcProvider;
  private usdcContract: ethers.Contract;
  private readmePath: string;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(BASE_RPC_URL);
    this.readmePath = join(process.cwd(), 'README.md');
    
    // USDC Contract ABI (minimal for Transfer events)
    const usdcAbi = [
      'event Transfer(address indexed from, address indexed to, uint256 value)'
    ];
    
    this.usdcContract = new ethers.Contract(
      BASE_USDC_CONTRACT,
      usdcAbi,
      this.provider
    );
  }

  /**
   * Query historical Transfer events from Base USDC contract
   */
  private async getTransferEvents(fromBlock: number, toBlock: number): Promise<TransferEvent[]> {
    try {
      console.log(`🔍 Scanning blocks ${fromBlock} to ${toBlock} for USDC transfers...`);
      
      // Use optional chaining and provide fallback for strict null checks
      const transferFilterFunc = this.usdcContract.filters?.Transfer;
      if (!transferFilterFunc) {
        throw new Error('Transfer filter not available in contract');
      }
      
      const transferFilter = transferFilterFunc();
      const events = await this.usdcContract.queryFilter(transferFilter, fromBlock, toBlock);
      
      return events.map(event => {
        // Type guard to ensure we have an EventLog with args
        if (!('args' in event) || !event.args) {
          throw new Error('Invalid event log: missing args');
        }
        
        const eventLog = event as ethers.EventLog;
        const args = eventLog.args;
        
        // Additional safety checks for array access
        if (!args[0] || !args[1] || args[2] === undefined) {
          throw new Error('Invalid Transfer event args');
        }
        
        return {
          from: args[0] as string,
          to: args[1] as string,
          value: args[2] as bigint,
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash
        };
      });
    } catch (error) {
      console.error('❌ SCRIPT CRASHED WITH ERROR:', error);
      return [];
    }
  }

  /**
   * Filter and deduplicate unique destination wallets that received payments
   */
  private deduplicateActiveNodes(transfers: TransferEvent[]): string[] {
    const uniqueReceivers = new Set<string>();
    
    // Filter out zero-value transfers and collect unique receivers
    transfers.forEach(transfer => {
      if (transfer.value > 0n && transfer.to !== ethers.ZeroAddress) {
        uniqueReceivers.add(transfer.to.toLowerCase());
      }
    });
    
    return Array.from(uniqueReceivers);
  }

  /**
   * Check if a wallet address is already logged in README
   */
  private isAddressAlreadyLogged(address: string): boolean {
    try {
      const readmeContent = readFileSync(this.readmePath, 'utf-8');
      return readmeContent.includes(address.toLowerCase());
    } catch (error) {
      console.warn('⚠️ Could not read README.md, assuming address is new');
      return false;
    }
  }

  /**
   * Append newly discovered nodes to README.md
   */
  private logNewActiveNodes(newNodes: string[]): { processed: number; total: number } {
    if (newNodes.length === 0) {
      return { processed: 0, total: 0 };
    }

    const timestamp = new Date().toISOString();
    
    // Limit to top 3 signals to prevent markdown spam
    const topSignals = newNodes.slice(0, 3);
    const skippedCount = newNodes.length - topSignals.length;
    
    // Generate clean 5-line blocks for each new node
    const logEntries = topSignals.map(node => {
      // Truncate address: first 6 + last 4 characters
      const truncatedAddress = `${node.slice(0, 6)}...${node.slice(-4)}`;
      
      // Create exactly 5 lines per node
      return [
        '', // Line 1: Empty line for breathing room
        `* 🌐 **Active Node Variant ID:** ${truncatedAddress}`, // Line 2: Main bullet
        '  - **Protocol Event Sig:** Standard Base ERC-20 `Transfer` Log Checked', // Line 3: Sub-bullet
        '  - **Network Settlement:** Live USDC Verification Complete (Chain ID: 8453)', // Line 4: Sub-bullet
        `  - **Discovered On:** ${timestamp}` // Line 5: Timestamp sub-bullet
      ].join('\n');
    }).join('\n');

    try {
      appendFileSync(this.readmePath, logEntries + '\n');
      console.log(`📝 Appended ${topSignals.length} new active nodes to README.md`);
      topSignals.forEach(node => {
        const truncated = `${node.slice(0, 6)}...${node.slice(-4)}`;
        console.log(`   └─ ${truncated}`);
      });
      return { processed: topSignals.length, total: newNodes.length };
    } catch (error) {
      console.error('❌ SCRIPT CRASHED WITH ERROR:', error);
      return { processed: 0, total: newNodes.length };
    }
  }

  /**
   * Main execution flow
   */
  public async scanAndIndex(): Promise<void> {
    try {
      console.log('📡 Starting Base L2 network scan...');
      
      // Get current block number
      const currentBlock = await this.provider.getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - BLOCKS_TO_SCAN);
      
      console.log(`📊 Current block: ${currentBlock}, scanning from block ${fromBlock}`);
      
      // Query transfer events
      const transfers = await this.getTransferEvents(fromBlock, currentBlock);
      console.log(`🔄 Found ${transfers.length} total transfer events`);
      
      if (transfers.length === 0) {
        console.log('ℹ️ No transfer events found in the specified range');
        return;
      }
      
      // Deduplicate active payment receivers
      const uniqueNodes = this.deduplicateActiveNodes(transfers);
      console.log(`🎯 Identified ${uniqueNodes.length} unique active payment receivers`);
      
      // Filter out already logged addresses
      const newNodes = uniqueNodes.filter(node => !this.isAddressAlreadyLogged(node));
      
      // Append new discoveries to README
      const result = this.logNewActiveNodes(newNodes);
      
      // Print completion status
      if (result.processed > 0) {
        const skippedCount = result.total - result.processed;
        if (skippedCount > 0) {
          console.log(`✅ Scan complete. Appended the top 3 premium signals to README! (Skipped ${skippedCount} remaining to prevent markdown spam.)`);
        } else {
          console.log(`✅ Scan complete. Appended ${result.processed} new nodes to README!`);
        }
      } else {
        console.log('ℹ️ Scan complete. No new nodes found in this block window.');
      }
      
    } catch (error) {
      console.error('❌ SCRIPT CRASHED WITH ERROR:', error);
      process.exit(1);
    }
  }
}

// Execute if run directly
async function main() {
  try {
    const scanner = new BaseSignalFinder();
    await scanner.scanAndIndex();
  } catch (error) {
    console.error('❌ SCRIPT CRASHED WITH ERROR:', error);
    process.exit(1);
  }
}

// Run the main function immediately
main();