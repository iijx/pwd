import type { AccountItem, ServiceItem } from "@/types/vault";

export function filterServices(services: ServiceItem[], accounts: AccountItem[], keyword: string) {
  const query = keyword.trim().toLowerCase();
  if (!query) return services;

  return services.filter((service) => {
    const serviceText = [service.name, service.url, service.category, service.notes]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (serviceText.includes(query)) return true;

    return accounts.some((account) => {
      if (account.serviceId !== service.id) return false;
      const accountText = [
        account.label,
        account.username,
        account.notes,
        ...account.customFields.map((field: { name: string; value: string }) => `${field.name} ${field.value}`),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return accountText.includes(query);
    });
  });
}
