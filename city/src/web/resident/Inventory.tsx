// Stores: total, reserved and available per resource, against the cap.
import { RESOURCES, type Inventory as InventoryState } from '../../shared/contracts';
import { RESOURCE_CAP } from '../../shared/rules';
import { RESOURCE_LABEL } from '../format';
import { GlyphIcon } from '../world/art';

export function Inventory({ inventory }: { inventory: InventoryState }) {
  return (
    <dl className="stores">
      {RESOURCES.map((resource) => {
        const { total, reserved } = inventory[resource];
        const free = total - reserved;
        return (
          <div key={resource} className={`store store--${resource}`}>
            <dt>
              <GlyphIcon glyph={resource} />
              {RESOURCE_LABEL[resource]}
            </dt>
            <dd>
              <span className="store-figure num">
                {total}
                <span className="store-cap">/{RESOURCE_CAP}</span>
              </span>
              <span
                className="store-bar"
                role="img"
                aria-label={`${total} of ${RESOURCE_CAP}${reserved ? `, ${reserved} reserved for building, ${free} available` : ''}`}
              >
                <span className="store-free" style={{ width: `${(free / RESOURCE_CAP) * 100}%` }} />
                <span className="store-reserved" style={{ width: `${(reserved / RESOURCE_CAP) * 100}%` }} />
              </span>
              <span className="store-note num">{reserved ? `${reserved} reserved` : ' '}</span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
