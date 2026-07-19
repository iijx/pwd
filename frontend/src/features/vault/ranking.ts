import type { ServiceItem } from "@/types/vault";

export function sortServices(services: ServiceItem[]) {
  return [...services].sort((left, right) => {
    if (right.usageCount !== left.usageCount) return right.usageCount - left.usageCount;
    return left.name.localeCompare(right.name);
  });
}

export function serviceInitial(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}
