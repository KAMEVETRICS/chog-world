import { getCreateAddress, keccak256 } from "ethers";

export async function prepareTransaction(signer, transaction) {
  // Public RPCs can reject an omitted estimate cap. Use the returned estimate on chain.
  const gasLimit = await signer.estimateGas({ ...transaction, gasLimit: 8_000_000n });
  return signer.populateTransaction({ ...transaction, gasLimit });
}

export async function prepareDeployment(factory, args) {
  return prepareTransaction(factory.runner, await factory.getDeployTransaction(...args));
}

export async function deployAndRecord(factory, args, persist, { prepared } = {}) {
  const signer = factory.runner;
  const unsigned = prepared ?? await prepareDeployment(factory, args);
  const address = getCreateAddress({ from: await signer.getAddress(), nonce: unsigned.nonce });
  return sendAndRecord(signer, unsigned, { address }, persist);
}

export async function sendAndRecord(signer, unsigned, record, persist) {
  const signed = await signer.signTransaction(unsigned);
  record.transactionHash = keccak256(signed);
  record.nonce = unsigned.nonce;
  record.status = "prepared";
  // Save before broadcast: RPC companion reads can fail after a transaction was accepted.
  await persist(record);
  if (typeof signer.increment === "function") signer.increment();
  const transaction = await signer.provider.broadcastTransaction(signed);
  record.status = "pending";
  await persist(record);
  const receipt = await transaction.wait(1, 120_000);
  record.blockNumber = receipt.blockNumber;
  record.status = "confirmed";
  await persist(record);
  return record;
}
