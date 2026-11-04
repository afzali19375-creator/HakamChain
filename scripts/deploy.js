/**
 * Deploy script for IslamicEscrow.
 *
 *   Local :  npx hardhat node
 *            npm run deploy:local
 *   Sepolia: npm run deploy:sepolia   (requires .env: RPC_URL_SEPOLIA + ADMIN_PRIVATE_KEY)
 *
 * After deployment the script writes deployments/<network>.json and prints
 * the CONTRACT_ADDRESS you must copy into your .env file.
 */
const fs = require('fs');
const path = require('path');
const { ethers, network } = require('hardhat');

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Network  :', network.name, `(chainId ${network.config.chainId ?? '-'})`);
  console.log('Deployer :', deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('Balance  :', ethers.formatEther(balance), 'ETH');
  if (balance === 0n && network.name !== 'hardhat' && network.name !== 'localhost') {
    throw new Error('Deployer has no ETH — get Sepolia ETH from a faucet first (see README).');
  }

  console.log('Deploying IslamicEscrow…');
  const factory = await ethers.getContractFactory('IslamicEscrow');
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const txHash = contract.deploymentTransaction() ? contract.deploymentTransaction().hash : null;

  console.log('--------------------------------------------------');
  console.log('IslamicEscrow deployed at:', address);
  console.log('Deployment tx           :', txHash);
  console.log('Max deposit (safe margin):', ethers.formatEther(await contract.MAX_DEPOSIT()), 'ETH');
  console.log('Owner (platform حَکَم)    :', await contract.owner());
  console.log('--------------------------------------------------');

  const dir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(dir, { recursive: true });
  const record = {
    network: network.name,
    contractName: 'IslamicEscrow',
    address,
    txHash,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(record, null, 2));
  console.log(`Saved → deployments/${network.name}.json`);

  // ------------------------------------------------------------------
  // Auto-sync .env so the backend immediately uses this contract address.
  // On a local Hardhat deploy this is fully hands-free: if .env does not
  // exist yet, a ready-to-use one is created with the well-known demo keys.
  // ------------------------------------------------------------------
  const envPath = path.join(__dirname, '..', '.env');
  if (network.name === 'localhost' && !fs.existsSync(envPath)) {
    const defaults = [
      'NODE_ENV=development',
      'PORT=3000',
      'SESSION_SECRET=hakamchain-local-secret-123',
      `CHAIN_ID=${network.config.chainId ?? 31337}`,
      'RPC_URL_SEPOLIA=http://127.0.0.1:8545',
      'ADMIN_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      `ADMIN_ADDRESSES=${deployer.address.toLowerCase()}`,
      `CONTRACT_ADDRESS=${address}`,
      'DB_STORAGE=./data/hakamchain.sqlite',
      '',
    ];
    fs.writeFileSync(envPath, defaults.join('\n'));
    console.log('Created a ready-to-use .env with local demo defaults ✓');
  } else if (fs.existsSync(envPath)) {
    let envContent = fs.readFileSync(envPath, 'utf8');
    const line = `CONTRACT_ADDRESS=${address}`;
    if (/^CONTRACT_ADDRESS=.*$/m.test(envContent)) {
      envContent = envContent.replace(/^CONTRACT_ADDRESS=.*$/m, line);
    } else {
      if (envContent && !envContent.endsWith('\n')) envContent += '\n';
      envContent += `${line}\n`;
    }
    fs.writeFileSync(envPath, envContent);
    console.log(`.env updated → ${line}`);
  } else {
    console.log(`\nNext step: add this line to your .env file:\n  CONTRACT_ADDRESS=${address}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
