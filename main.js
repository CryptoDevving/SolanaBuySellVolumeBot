import fetch from "node-fetch";
import fs from "fs/promises";
import chalk from "chalk";
import { Connection, Keypair, VersionedTransaction, PublicKey, Transaction, sendAndConfirmRawTransaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import web3 from "@solana/web3.js";
import bs58 from 'bs58';
import dotenv from 'dotenv';
import { Wallet } from '@project-serum/anchor';
import axios from 'axios';
import prompt from 'prompt-sync';

dotenv.config();

const solAddress = "So11111111111111111111111111111111111111112";
// Solana gas price = 0.0001 ~ 0.0003
const SOLANA_GAS_PRICE = 0.0003 * LAMPORTS_PER_SOL;
let slipTarget = 5;
const RPC_ENDPOINT = "https://api.mainnet-beta.solana.com";


const connection = new Connection(RPC_ENDPOINT, 'confirmed', {
    commitment: 'confirmed',
    timeout: 10000
});

async function getTokenBalance(publicKey, tokenAddress) {
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: tokenAddress });
    const tokenAccountInfo = tokenAccounts && tokenAccounts.value[0] && tokenAccounts.value[0].account;
    const tokenTokenAccount = tokenAccountInfo.data.parsed.info;
    const tokenBalance = tokenTokenAccount.tokenAmount.uiAmount;
    return tokenBalance;
}

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms * 1000); //s = ms*1000
    })
}

async function sendSol(sourcePrvKey, targetAddress, amount) {
    if (amount <= 0) {
        console.log("Amount is less than 0.\n");
        return;
    }
    const from = Keypair.fromSecretKey(bs58.decode(sourcePrvKey));
    //consider lamports: amount * LAMPORTS_PER_SOL
    console.log('Send sol amount', amount);
    const transferInstruction = web3.SystemProgram.transfer({
        fromPubkey: from.publicKey,
        toPubkey: new PublicKey(targetAddress),
        lamports: 0,
    });
    const transaction = new Transaction().add(transferInstruction)

    // Sign transaction, broadcast, and confirm
    try {
        const txid = await sendAndConfirmTransaction(
            connection,
            transaction,
            [from]
        );
        console.log('send SOL::' + `https://solscan.io/tx/${txid}`);
    } catch (error) {
        console.log('error', error);
    }
    sleep(0.6); // 0.6 second delay to avoid 429 too many requests

}

async function makeSwap(tokenAddress, amount, type, wallet) {
    if (amount <= 0) {
        console.log("amount is less than 0\n");
        return;
    }
    const fixedSwapValLamports = Math.floor(amount);
    const slipBPS = slipTarget * 100;
    let response;
    if (type == "buy") {
        response = await fetch('https://quote-api.jup.ag/v6/quote?inputMint=' + solAddress + '&outputMint=' + tokenAddress + '&amount=' + fixedSwapValLamports + '&onlyDirectRoutes=true');
    } else {
        response = await fetch('https://quote-api.jup.ag/v6/quote?inputMint=' + tokenAddress + '&outputMint=' + solAddress + '&amount=' + fixedSwapValLamports + '&onlyDirectRoutes=true');
    }
    const routes = await response.json();
    const transaction_response = await fetch('https://quote-api.jup.ag/v6/swap', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            quoteResponse: routes,
            userPublicKey: wallet.publicKey.toString(),
            wrapUnwrapSOL: true,
            prioritizationFeeLamports: "auto",
            dynamicComputeUnitLimit: true,
        })
    });
    const transactions = await transaction_response.json();
    const { swapTransaction } = transactions;
    // deserialize the transaction
    const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    // sign the transaction
    transaction.sign([wallet.payer]);
    // Execute the transaction
    const rawTransaction = transaction.serialize()
    const txid = await sendAndConfirmRawTransaction(connection, rawTransaction, null, {
        skipPreflight: true,
        maxRetries: 2
    });
    console.log(type + " Order::" + `https://solscan.io/tx/${txid}`);
    sleep(0.6); // 0.6 second delay to avoid 429 too many requests

}


//split total amount into 10 parts - each part is greater than minAmount
function split(totalAmount, minAmount, count = 10) {
    const ratios = Array.from({ length: count }, () => parseInt(Math.random() * 1000));
    const total_ratio = ratios.reduce((a, b) => a + b, 0);
    const shareProfit = totalAmount - minAmount * count;
    if (shareProfit <= 0) {
        console.log("=== TotalAmount and minAmount are incorrect!");
        process.exit(1);
    }
    const parts = ratios.map(ratio => Math.floor(shareProfit * ratio / total_ratio) + minAmount);
    let sum = 0;
    for (let i = 0; i < parts.length - 1; i = i + 1) {
        sum = sum + parts[i];
    }
    parts[parts.length - 1] = totalAmount - sum;
    return parts;
}

async function main() {
    try {
        console.log('Choose option:\n' +
            '[1] Generate volume\n' +
            '[2] Clear wallets with tokens\n' +
            '[3] Clear wallets with SOL');
        let opt = parseInt(prompt()('Choose Number: '));

        if (opt == 2) { //swap tokens to SOL in all wallets
            const fileName = prompt()("Please enter file name of wallet address: ");
            const fileContent = (await fs.readFile("data/" + fileName)).toString();
            if (fileContent == "") {
                console.log("There aren't wallet addresses.");
                process.exit(1);
            }
            const tokenAddress = prompt()('Please enter token address: '); // Token address to swap
            const wallets_ = fileContent.split('\n');
            console.log('fileContent: ', fileContent);
            const wallets = {};
            wallets_.forEach(x => {
                if (x != "") {
                    const address = x.split(' , ')[0].toString();
                    const pKey = x.split(' , ')[1].toString();
                    wallets[address] = pKey;
                }
            });
            Object.keys(wallets).forEach(x => {
                //swap token to Sol
                const tempWallet = new Wallet(Keypair.fromSecretKey(bs58.decode(wallets[x])));
                const amount = getTokenBalance(new PublicKey(x), tokenAddress);
                makeSwap(tokenAddress, amount, "sell", tempWallet); //token address to swap, amount, (Buy or Sell), wallet owner
            });
            console.log('Done');
            process.exit();
        }
        else if (opt == 3) { //send SOL to target address from all wallets
            const fileName = prompt()("Please enter file name of wallet address: ");
            const fileContent = (await fs.readFile("data/" + fileName)).toString();
            if (fileContent == "") {
                console.log("There aren't wallet addresses.");
                process.exit(1);
            }
            const targetAddress = prompt()('Please enter address to send funds: '); // Token address to swap
            const wallets_ = fileContent.split('\n');
            const wallets = {};
            wallets_.forEach(x => {
                if (x != "") {
                    const address = x.split(' , ')[0].toString();
                    const pKey = x.split(' , ')[1].toString();
                    wallets[address] = pKey;
                }
            });
            Object.keys(wallets).forEach(async (x) => {
                const tempWallet = new Wallet(Keypair.fromSecretKey(bs58.decode(wallets[x])));
                const amount = await connection.getBalance(tempWallet.publicKey);
                // send all sol in the address to the target Address
                if (amount > SOLANA_GAS_PRICE) { //amount > 0.0003 sol (average gas price)
                    sendSol(wallets[x], targetAddress, amount - SOLANA_GAS_PRICE)
                }
            });
            console.log('Done');
            process.exit();
        } else if (opt == 1) {
            //read keypair and decode to public and private keys.
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth() + 1; // Months are zero-indexed, so add 1
            const date = now.getDate();
            const hour = now.getHours();
            const minute = now.getMinutes();
            const second = now.getSeconds();

            // Create a string with the current date and time
            const fileName = 'data/' + `${year}-${month}-${date}-${hour}-${minute}-${second}.txt`;

            const adminWallet = Keypair.generate();
            const adminWallet_prv = bs58.encode(adminWallet.secretKey);
            const adminWallet_pub = adminWallet.publicKey;
            // const adminWallet = new Wallet(Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY)));

            console.log(`\n Admin wallet generated\n
                        Private Key: ${adminWallet_prv}\n
                        Public key: ${adminWallet_pub}\n`);
            console.log('Deposit funds to this wallet and press enter....\n');
            await fs.appendFile(fileName, adminWallet_pub + " , " + adminWallet_prv + "\n");
            let solTotalBalance = await connection.getBalance(adminWallet_pub);
            while (solTotalBalance === 0) {
                solTotalBalance = await connection.getBalance(adminWallet_pub);
                if (solTotalBalance > 0) {
                    break;
                }
            }
            console.log(`Admin Wallet Balance: ${solTotalBalance / LAMPORTS_PER_SOL}\n`);
            const tokenAddress = prompt()('Please enter token address: '); // Token address to swap
            console.log('Rise holders amount?\n' +
                '[Y]es\n' +
                '[N]o\n');
            const opt = prompt()("Y or N: ");
            let bRideHolders;
            if (opt.toLowerCase() !== 'y' && opt.toLowerCase() !== 'n') {
                console.log('Choose y or n');
                process.exit(0);
            }
            if (opt.toLowerCase() === 'y') {
                bRideHolders = true;
            } else if (opt.toLowerCase() === 'n') {
                bRideHolders = false;
            }
            const firstStage = 10;
            const secondStage = 10;
            console.log(`Generating first ${firstStage} wallets`);
            const first10Wallets = [];
            for (let x = 0; x < firstStage; x++) {
                const _account = Keypair.generate();
                const _account_prv = bs58.encode(_account.secretKey);
                const _account_pub = _account.publicKey;
                await fs.appendFile(fileName, _account_pub + " , " + _account_prv + "\n");
                first10Wallets.push(_account);
            }
            const walletsToSwap = []; //
            const rTotalBalance = solTotalBalance - SOLANA_GAS_PRICE * 11;
            const _minToSend = rTotalBalance / 100;
            const amountList = split(rTotalBalance, _minToSend);
            console.log(`First Stage...\n`);
            for (const x of first10Wallets) {
                await sendSol(adminWallet_prv, x.publicKey.toString(), amountList[first10Wallets.indexOf(x)]);
            }
            console.log(`First Stage is Done.\n`);
            console.log(`Second stage for spreading funds....\n`);
            for (const fi of first10Wallets) {
                const second10Wallets = [];
                for (let d = 0; d < secondStage; d++) {
                    const _account = Keypair.generate();
                    const _account_prv = bs58.encode(_account.secretKey);
                    const _account_pub = _account.publicKey;
                    await fs.appendFile(fileName, _account_pub + " , " + _account_prv + "\n");
                    second10Wallets.push(_account);
                    walletsToSwap.push(_account);
                }
                const fiBalance = await connection.getBalance(fi.publicKey) - (SOLANA_GAS_PRICE * 11);
                const _minToSend2 = fiBalance / 100;
                const amountList2 = split(fiBalance, _minToSend2);
                for (const y of second10Wallets) {
                    const fiAmount = await connection.getBalance(fi.publicKey);
                    sendSol(bs58.encode(fi.secretKey), y.publicKey.toString(), amountList2[second10Wallets.indexOf(y)]);
                }
            }
            console.log('First Buying!');
            for (const wal of walletsToSwap) {
                const _balance = await connection.getBalance(wal.publicKey);
                const _amount = parseInt((_balance * 30) / 100);
                console.log(`wallet: ${wal.publicKey} balance: ${_balance}`);
                console.log('swapping 30% for Sol to Token');
                const tempWallet = new Wallet(Keypair.fromSecretKey(wal.secretKey));
                makeSwap(tokenAddress, _amount, "buy", tempWallet);
            }
            console.log('Randomly buying or selling');
            while (true) {
                const activeWallets = walletsToSwap;
                const walletsToRemove = [];
                const walletsToAdd = [];
                console.log(`active wallets: ${activeWallets.length}`);
                for (const wal of activeWallets) {
                    console.log(`wallet ${activeWallets.indexOf(wal)}/${activeWallets.length}`);
                    const buyOrSell = Math.floor(Math.random() * 2); // 0 is sell, 1 is buy more
                    if (buyOrSell == 0) { //sell
                        const _balance = await connection.getBalance(wal.publicKey);
                        if (_balance == 0) { //tokenBalance == 0 ? swap sol to token( 30% Sol to token)
                            const _balance = await getTokenBalance(wal.publicKey, tokenAddress);
                            const _amount = parseInt((_balance * 30) / 100);
                            const tempWallet = new Wallet(Keypair.fromSecretKey(wal.secretKey));
                            makeSwap(tokenAddress, _amount, "buy", tempWallet);
                        }
                        if (bRideHolders == true) { //swapTokenToSol (80% token to Sol) & sendSol(newWallet)
                            const _balance = await getTokenBalance(wal.publicKey, tokenAddress);
                            const _amount = parseInt((_balance * 80) / 100);
                            const tempWallet = new Wallet(Keypair.fromSecretKey(wal.secretKey));
                            makeSwap(tokenAddress, _amount, "sell", tempWallet);
                            //
                            const balanceSol = await connection.getBalance(wal.publicKey);
                            if (balanceSol > SOLANA_GAS_PRICE) {
                                const newWallet = Keypair.generate();
                                const _account_prv = bs58.encode(newWallet.secretKey);
                                const _account_pub = newWallet.publicKey;
                                await fs.appendFile(fileName, _account_pub + " , " + _account_prv + "\n");
                                walletsToAdd.push(newWallet);
                                walletsToRemove.push(wal);
                                sendSol(bs58.encode(wal.secretKey), newWallet.publicKey.toString(), balanceSol - SOLANA_GAS_PRICE);
                            }
                        } else if (bRideHolders == false) { //swapTokenToSOL(100% token to SOL) & sendSOL(new Wallet)
                            const _balance = await getTokenBalance(wal.publicKey, tokenAddress);
                            const tempWallet = new Wallet(Keypair.fromSecretKey(wal.secretKey));
                            makeSwap(tokenAddress, _balance, "sell", tempWallet);
                            //
                            const balanceSol = await connection.getBalance(wal.publicKey);
                            if (balanceSol > SOLANA_GAS_PRICE) {
                                const newWallet = Keypair.generate();
                                const _account_prv = bs58.encode(newWallet.secretKey);
                                const _account_pub = newWallet.publicKey;
                                await fs.appendFile(fileName, _account_pub + " , " + _account_prv + "\n");
                                walletsToAdd.push(newWallet);
                                walletsToRemove.push(wal);
                                sendSol(bs58.encode(wal.secretKey), newWallet.publicKey.toString(), balanceSol - SOLANA_GAS_PRICE);
                            }
                        }
                    } else { //buy 30% Sol to token
                        const _balance = await connection.getBalance(wal.publicKey);
                        const _amount = parseInt((_balance * 30) / 100);
                        const tempWallet = new Wallet(Keypair.fromSecretKey(wal.secretKey));
                        makeSwap(tokenAddress, _amount, "buy", tempWallet);
                    }
                }
                walletsToAdd.forEach(x => walletsToSwap.push(x));
                walletsToRemove.forEach(x => walletsToSwap.splice(walletsToSwap.indexOf(x), 1));
                await sleep(60); //wait for 60 seconds
            }
        }

    }
    catch (error) {
        console.log(error);
    }
}
main()