// The env registry owns key membership; this map explains each key. readCapabilityGroups
// checks both directions so drift cannot hide a key.
import { AppError } from '@/lib/errors';
import type { EnvKeyStatus } from './env-status';

import {
  CAPABILITY_GROUPS,
  type CapabilityGroup,
  type CapabilityInfo,
  ENV_CAPABILITIES,
  GROUP_ORDER,
} from './environment-capability-map';

export type CapabilityKey = Omit<EnvKeyStatus, 'group'> & CapabilityInfo;

export type CapabilitySection = {
  group: CapabilityGroup;
  keys: readonly CapabilityKey[];
};

export function readCapabilityGroups(keys: readonly EnvKeyStatus[]): readonly CapabilitySection[] {
  const registryNames = new Set(keys.map((key) => key.name));
  const capabilityMap: Readonly<Record<string, CapabilityInfo>> = ENV_CAPABILITIES;
  const capability = (name: string): CapabilityInfo | undefined => capabilityMap[name];
  const missingRows = keys.filter((key) => capability(key.name) === undefined);
  const staleRows = Object.keys(ENV_CAPABILITIES).filter((name) => !registryNames.has(name));

  // The order lists and the map must describe the same world: every key exactly
  // once, in the group its capability row names.
  const orderedNames: readonly string[] = CAPABILITY_GROUPS.flatMap((group) => GROUP_ORDER[group]);
  const orderDrift =
    orderedNames.length !== new Set(orderedNames).size ||
    Object.keys(ENV_CAPABILITIES).some((name) => !orderedNames.includes(name)) ||
    CAPABILITY_GROUPS.some((group) =>
      GROUP_ORDER[group].some((name) => ENV_CAPABILITIES[name].group !== group),
    );

  if (missingRows.length > 0 || staleRows.length > 0 || orderDrift) {
    throw new AppError('UNEXPECTED', 'The environment capability map is out of date', {
      missingRows: missingRows.map((key) => key.name),
      staleRows,
      orderDrift,
    });
  }

  const displayKeys = new Map(
    keys.map((key) => {
      const info = capability(key.name);
      if (info === undefined) {
        throw new AppError('UNEXPECTED', 'An environment key has no capability row', {
          key: key.name,
        });
      }
      return [key.name, { ...key, ...info }];
    }),
  );
  return CAPABILITY_GROUPS.map((group) => ({
    group,
    keys: GROUP_ORDER[group].flatMap((name) => {
      const key = displayKeys.get(name);
      return key ? [key] : [];
    }),
  }));
}
