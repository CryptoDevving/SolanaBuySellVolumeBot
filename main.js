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
//For test, my wallet:        9bUe24UVqz9X4AqoRHNFu3idaDLtRGXTYD2CP45bzsgD
//For test, use DLM token:    DLMnnSzTJWZUiL7RXUpAnNZVBgbGv7pFaMGWe8AbqCeG
const solAddress = "So11111111111111111111111111111111111111112";
// Solana gas fee
const SOLANA_GAS_FEE_PRICE = 0.000005 * LAMPORTS_PER_SOL;  //Solana accounts require a minimum amount of SOL in order to exists on the blockchain, this is called rent-exempt account.
let slipTarget = 5;

// total holders: firststage * secondstage
let firstStage = 2;  //How many holders do you want to add
let secondStage = 2; // how many holders do you want to add

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
    // Solana accounts require a minimum amount of SOL in order to exists on the blockchain, this is called rent-exempt account.
    const rAmount = amount - SOLANA_GAS_FEE_PRICE;
    if (rAmount < 0) {
        console.log("Balance is less than Gas Fee");
        return;
    }
    const from = Keypair.fromSecretKey(bs58.decode(sourcePrvKey));
    const transferInstruction = web3.SystemProgram.transfer({
        fromPubkey: from.publicKey,
        toPubkey: new PublicKey(targetAddress),
        lamports: rAmount
    });
    let transaction = new Transaction().add(transferInstruction)

    // const blockhash = (await connection.getLatestBlockhash('finalized')).blockhash;
    // transaction.recentBlockhash = blockhash;
    // transaction.feePayer = from.publicKey;
    // const gasFee = await transaction.getEstimatedFee(connection);

    // console.log('send SOL  GAS Fee---', gasFee/LAMPORTS_PER_SOL);
    // if (amount < gasFee) {
    //     console.log('SOL Balance is less than Gas Fee.');
    //     return;
    // }
    console.log('Send SOL amount - ', (amount - SOLANA_GAS_FEE_PRICE)/ LAMPORTS_PER_SOL);
    // const transferInstruction1 = web3.SystemProgram.transfer({
    //     fromPubkey: from.publicKey,
    //     toPubkey: new PublicKey(targetAddress),
    //     lamports: amount - gasFee,
    // });
    // const transaction1 = new Transaction().add(transferInstruction1)
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
    await sleep(1); // 1 second delay to avoid 429 too many requests

}

async function makeSwap(tokenAddress, amount, type, wallet) {
    const rAmount = amount - SOLANA_GAS_FEE_PRICE;
    if (rAmount < 0) {
        console.log("amount is less than gas Fee");
        return;
    }
    console.log("swap amount: ", rAmount/LAMPORTS_PER_SOL);
    console.log("swap type: ", type);
    console.log("swap wallet", wallet.publicKey.toString());

    const fixedSwapValLamports = Math.floor(rAmount);
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
    await sleep(1); // 1 second delay to avoid 429 too many requests

}

//split total amount into 10 parts - each part is greater than minAmount
//Solana accounts require a minimum amount of SOL in order to exists on the blockchain, this is called rent-exempt account.
function split(totalAmount, stage) {
    const rMinAmount = (stage == 1 ? SOLANA_GAS_FEE_PRICE * firstStage : SOLANA_GAS_FEE_PRICE);
    const splitCount = (stage == 1? firstStage : secondStage);
    const ratios = Array.from({ length: splitCount }, () => parseInt(Math.random() * 1000));
    const total_ratio = ratios.reduce((a, b) => a + b, 0);
    const shareProfit = totalAmount - rMinAmount * splitCount;
    if (shareProfit < 0) {
        console.log("=== TotalAmount and minAmount are incorrect! ===");
        process.exit(1);
    }
    const parts = ratios.map(ratio => Math.floor(shareProfit * ratio / total_ratio) + rMinAmount);
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
            for (const x of Object.keys(wallets)) {
                //swap token to Sol
                const tempWallet = new Wallet(Keypair.fromSecretKey(bs58.decode(wallets[x])));
                const amount = getTokenBalance(new PublicKey(x), new PublicKey(tokenAddress));
                await makeSwap(tokenAddress, amount, "sell", tempWallet); //token address to swap, amount, (Buy or Sell), wallet owner
            };
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
            for (const x of Object.keys(wallets)) {
                const tempWallet = new Wallet(Keypair.fromSecretKey(bs58.decode(wallets[x])));
                const amount = await connection.getBalance(tempWallet.publicKey);
                // send all sol in the address to the target Address
                console.log("--wallet address: ", tempWallet.publicKey + ", balance: " + amount/LAMPORTS_PER_SOL);
                await sendSol(wallets[x], targetAddress, amount); //
            }
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
            console.log("Total Holders = FirstStage * SecondStage\n");
            firstStage = prompt()("Please input FirstStage number:");
            secondStage = prompt()("Please input secondStage number:");

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
            const amountList = split(solTotalBalance, 1); //first stage, so stage = 1
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
                const fiBalance = await connection.getBalance(fi.publicKey);
                const amountList2 = split(fiBalance, 2); //second stage, so stage = 2
                for (const y of second10Wallets) {
                    await sendSol(bs58.encode(fi.secretKey), y.publicKey.toString(), amountList2[second10Wallets.indexOf(y)]);
                }
            }
            console.log('First Buying!');
            for (const wal of walletsToSwap) {
                const _balance = await connection.getBalance(wal.publicKey);
                const _amount = parseInt((_balance * 30) / 100);
                console.log(`wallet: ${wal.publicKey}, balance: ${_balance/LAMPORTS_PER_SOL}`);
                console.log('swapping 30% for Sol to Token');
                const tempWallet = new Wallet(Keypair.fromSecretKey(wal.secretKey));
                await makeSwap(tokenAddress, _amount, "buy", tempWallet);
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
                            const _balance = await getTokenBalance(wal.publicKey, new PublicKey(tokenAddress));
                            const _amount = parseInt((_balance * 30) / 100);
                            const tempWallet = new Wallet(Keypair.fromSecretKey(wal.secretKey));
                            await makeSwap(tokenAddress, _amount, "buy", tempWallet);
                        }
                        if (bRideHolders == true) { //swapTokenToSol (80% token to Sol) & sendSol(newWallet)
                            const _balance = await getTokenBalance(wal.publicKey, new PublicKey(tokenAddress));
                            const _amount = parseInt((_balance * 80) / 100);
                            const tempWallet = new Wallet(Keypair.fromSecretKey(wal.secretKey));
                            await makeSwap(tokenAddress, _amount, "sell", tempWallet);
                            //
                            const balanceSol = await connection.getBalance(wal.publicKey);
                            if (balanceSol > SOLANA_GAS_FEE_PRICE) {
                                const newWallet = Keypair.generate();
                                const _account_prv = bs58.encode(newWallet.secretKey);
                                const _account_pub = newWallet.publicKey;
                                await fs.appendFile(fileName, _account_pub + " , " + _account_prv + "\n");
                                walletsToAdd.push(newWallet);
                                walletsToRemove.push(wal);
                                await sendSol(bs58.encode(wal.secretKey), newWallet.publicKey.toString(), balanceSol);
                            }
                        } else if (bRideHolders == false) { //swapTokenToSOL(100% token to SOL) & sendSOL(new Wallet)
                            const _balance = await getTokenBalance(wal.publicKey, new PublicKey(tokenAddress));
                            const tempWallet = new Wallet(Keypair.fromSecretKey(wal.secretKey));
                            makeSwap(tokenAddress, _balance, "sell", tempWallet);
                            //
                            const balanceSol = await connection.getBalance(wal.publicKey);
                            if (balanceSol > SOLANA_GAS_FEE_PRICE) {  
                                const newWallet = Keypair.generate();
                                const _account_prv = bs58.encode(newWallet.secretKey);
                                const _account_pub = newWallet.publicKey;
                                await fs.appendFile(fileName, _account_pub + " , " + _account_prv + "\n");
                                walletsToAdd.push(newWallet);
                                walletsToRemove.push(wal);
                                await sendSol(bs58.encode(wal.secretKey), newWallet.publicKey.toString(), balanceSol);
                            }
                        }
                    } else { //buy 30% Sol to token
                        const _balance = await connection.getBalance(wal.publicKey);
                        const _amount = parseInt((_balance * 30) / 100);
                        const tempWallet = new Wallet(Keypair.fromSecretKey(wal.secretKey));
                        await makeSwap(tokenAddress, _amount, "buy", tempWallet);
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