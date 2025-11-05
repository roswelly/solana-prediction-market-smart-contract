#!/bin/bash

# Prediction Market Deployment Script
# This script helps deploy the prediction market program to Solana

set -e

echo "🚀 Prediction Market Deployment Script"
echo "======================================="

# Check if Anchor is installed
if ! command -v anchor &> /dev/null; then
    echo "❌ Anchor CLI not found. Please install Anchor first:"
    echo "   cargo install --git https://github.com/coral-xyz/anchor avm --locked --force"
    echo "   avm install latest"
    echo "   avm use latest"
    exit 1
fi

# Check if Solana CLI is installed
if ! command -v solana &> /dev/null; then
    echo "❌ Solana CLI not found. Please install Solana first:"
    echo "   sh -c \"\$(curl -sSfL https://release.solana.com/stable/install)\""
    exit 1
fi

# Get cluster from Anchor.toml or use default
CLUSTER=${1:-localnet}
echo "📍 Target cluster: $CLUSTER"

# Build the program
echo ""
echo "🔨 Building program..."
anchor build

if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    exit 1
fi

echo "✅ Build successful!"

# Deploy based on cluster
if [ "$CLUSTER" == "localnet" ]; then
    echo ""
    echo "🌐 Checking for local validator..."
    
    # Check if validator is running
    if ! curl -s http://localhost:8899 > /dev/null 2>&1; then
        echo "⚠️  Local validator not detected!"
        echo "   Please start a local validator in another terminal:"
        echo "   solana-test-validator"
        echo ""
        read -p "Continue anyway? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
    
    echo "✅ Local validator detected"
    
    # Airdrop SOL if needed
    echo ""
    echo "💰 Checking SOL balance..."
    BALANCE=$(solana balance --url localhost 2>/dev/null | grep -oP '\d+\.\d+' || echo "0")
    if (( $(echo "$BALANCE < 1" | bc -l) )); then
        echo "   Airdropping SOL..."
        solana airdrop 10 --url localhost
    fi
fi

if [ "$CLUSTER" == "devnet" ]; then
    echo ""
    echo "💰 Checking SOL balance on devnet..."
    BALANCE=$(solana balance --url devnet 2>/dev/null | grep -oP '\d+\.\d+' || echo "0")
    if (( $(echo "$BALANCE < 1" | bc -l) )); then
        echo "   Airdropping SOL..."
        solana airdrop 2 --url devnet
    fi
fi

# Deploy
echo ""
echo "📦 Deploying program..."
anchor deploy

if [ $? -ne 0 ]; then
    echo "❌ Deployment failed!"
    exit 1
fi

echo ""
echo "✅ Deployment successful!"
echo ""
echo "📝 Next steps:"
echo "   1. Run tests: anchor test"
echo "   2. Check program account: solana account <PROGRAM_ID>"
echo "   3. View logs: solana logs"

