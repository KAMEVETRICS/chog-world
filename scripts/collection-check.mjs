import { Contract } from "ethers";

export async function inspectCollection(provider, address, { blockTag = "latest", chainId } = {}) {
  const code = await provider.getCode(address, blockTag);
  if (code === "0x") {
    throw new Error(`Collection ${address} has no deployed code on chain ${chainId ?? "selected"}. Local demo addresses do not exist on public testnet. Leave CHOG_COLLECTION_ADDRESS blank to deploy TestChog, or use an existing testnet ERC-721 address.`);
  }
  const collection = new Contract(address, ["function name() view returns (string)", "function supportsInterface(bytes4) view returns (bool)"], provider);
  // Bound read gas because some public RPCs reject the chain's default allowance.
  const callOptions = { blockTag, gasLimit: 100_000n };
  let erc721;
  try { erc721 = await collection.supportsInterface("0x80ac58cd", callOptions); }
  catch (cause) { throw new Error(`Could not verify ERC-721 support for ${address} on chain ${chainId ?? "selected"}.`, { cause }); }
  if (!erc721) throw new Error(`Collection ${address} does not support ERC-721 on chain ${chainId ?? "selected"}.`);
  // ERC-721 metadata is optional; name() is not an ownership/interface prerequisite.
  let name = null;
  try { name = await collection.name(callOptions); } catch {}
  return { collection: address, collectionName: name, collectionCodeBytes: (code.length - 2) / 2, erc721 };
}
