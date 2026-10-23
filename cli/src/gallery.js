import data from './genesis-gallery.json' with { type: 'json' };

/** Bundled public collection metadata, identical to City's token→revealed-artwork mapping. */
export function galleryChog(tokenId) {
  const row = data.tokens[Number(tokenId) - 1];
  if (!row) throw Error('Unknown Chog.');
  const traits = {};
  data.traits.forEach((name, index) => { if (row[index + 1] >= 0) traits[name] = data.values[index][row[index + 1]]; });
  return { tokenId: String(tokenId), name: `Chog #${tokenId}`, image: `${data.imageBase}${row[0]}.webp`, metadata: { attributes: Object.entries(traits).map(([trait_type, value]) => ({ trait_type, value })) } };
}
