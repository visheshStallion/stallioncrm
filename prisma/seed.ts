/**
 * Seed – FICTITIOUS data only. Wipes and recreates organisation data + demo deals.
 * Run: pnpm db:seed (also runs after `prisma migrate reset`).
 */
import { hash } from "@node-rs/argon2";
import { PrismaClient, type LeadSource, type LeadStatus, type LeadRating } from "@prisma/client";
import {
  ensureBrandTerritories,
  ensureRootTerritory,
} from "../src/server/access/territory";
import {
  ACTIVE_BRANDS,
  BRAND_ALIASES,
  BRANDS,
  CUSTOMERS,
  DEAL_STAGES,
  CATALOGUE_COLOURS,
  CATALOGUE_MODELS,
  CATALOGUE_VARIANTS,
  DEALS_PER_BRAND_REGION,
  LEAD_PEOPLE,
  LEAD_SOURCES_SEED,
  LEAD_STATUSES_SEED,
  LEADS_PER_BRAND_REGION,
  RATINGS_SEED,
  PROFILE_DEFS,
  REGIONS,
  ROLE_PARENTS,
  SEED_PASSWORD,
  USERS,
  VEHICLE_TYPES,
  email,
} from "./seed-data";
import { seedInventory } from "./seed-inventory";

export async function seed(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "AuditLog", "VehicleUnit", "Warehouse", "Vendor", "StockMovement", "StockBalance", "InventoryDocument", "JournalEntry", "InventorySettings", "PriceBookEntry", "PriceBook", "Note", "Attachment", "DealStageHistory", "Pipeline", "SavedView", "AssignmentRule", "Lead", "Deal", "Contact", "Account", "Product", "TerritoryMember", "Territory", "BrandCodeAlias", "User", "Brand", "Role", "Profile", "Region", "Job", "Holiday", "BusinessHours" CASCADE`,
  );
  // The cascade also empties the approval processes and workflow rules (they reference Brand): restore the defaults.
  await prisma.$executeRawUnsafe(`SELECT app_seed_automation()`);
  await prisma.$executeRawUnsafe(`SELECT app_seed_reports()`);
  await prisma.$executeRawUnsafe(`SELECT app_seed_cases()`);
  await prisma.$executeRawUnsafe(`SELECT app_seed_layouts()`);

  // Regions
  const regions = new Map<string, string>();
  for (const name of REGIONS) {
    const r = await prisma.region.create({ data: { name } });
    regions.set(name, r.id);
  }

  // Brands + aliases + territory tree (root → brand → brand–region)
  await ensureRootTerritory(prisma);
  const brands = new Map<string, string>();
  for (const b of BRANDS) {
    const brand = await prisma.brand.create({
      data: {
        code: b.code,
        name: b.name,
        color: b.color,
        status: b.status,
        legalEntity: `${b.code} legal entity (placeholder)`,
        erpCompanyCode: b.code,
        docPrefix: b.code,
      },
    });
    brands.set(b.code, brand.id);
    await ensureBrandTerritories(prisma, brand.id);
  }
  for (const a of BRAND_ALIASES) {
    await prisma.brandCodeAlias.create({
      data: { alias: a.alias, brandId: brands.get(a.brand)!, note: a.note },
    });
  }

  // Roles (parents first)
  const roles = new Map<string, string>();
  const pending = Object.entries(ROLE_PARENTS);
  while (pending.length) {
    const idx = pending.findIndex(([, parent]) => parent === null || roles.has(parent));
    const [name, parent] = pending.splice(idx, 1)[0]!;
    const role = await prisma.role.create({
      data: { name, parentRoleId: parent ? roles.get(parent) : null },
    });
    roles.set(name, role.id);
  }

  // Profiles
  const profiles = new Map<string, string>();
  for (const p of PROFILE_DEFS) {
    const profile = await prisma.profile.create({
      data: { name: p.name, scope: p.scope, permissions: p.permissions, fieldPermissions: p.fieldPermissions },
    });
    profiles.set(p.name, profile.id);
  }

  // Users
  const passwordHash = await hash(SEED_PASSWORD);
  const users = new Map<string, string>();
  for (const u of USERS) {
    const user = await prisma.user.create({
      data: {
        name: u.name,
        email: email(u.key),
        passwordHash,
        roleId: roles.get(u.role)!,
        profileId: profiles.get(u.profile)!,
      },
    });
    users.set(u.key, user.id);
  }
  for (const u of USERS) {
    if (u.manager) {
      await prisma.user.update({ where: { id: users.get(u.key)! }, data: { managerId: users.get(u.manager)! } });
    }
  }

  // Brand managers + territory managers
  for (const code of ACTIVE_BRANDS) {
    const bmId = users.get(`bm.${code.toLowerCase()}`)!;
    const brandId = brands.get(code)!;
    await prisma.brand.update({ where: { id: brandId }, data: { brandManagerId: bmId } });
    await prisma.territory.updateMany({ where: { brandId, regionId: null }, data: { managerId: bmId } });
    await prisma.territory.updateMany({
      where: { brandId, regionId: regions.get("Lagos")! },
      data: { managerId: bmId },
    });
  }
  await prisma.territory.updateMany({
    where: { regionId: { in: ["Abuja", "Port Harcourt", "Ibadan"].map((r) => regions.get(r)!) } },
    data: { managerId: users.get("rsm")! },
  });
  const territories = await prisma.territory.findMany();
  const rootId = territories.find((t) => t.level === 0)!.id;
  const territoryFor = (key: string): string => {
    if (key === "ROOT") return rootId;
    const [code, region] = key.split("|");
    const brandId = brands.get(code!)!;
    const regionId = region ? regions.get(region)! : null;
    const t = territories.find((x) => x.brandId === brandId && x.regionId === regionId);
    if (!t) throw new Error(`territory not found: ${key}`);
    return t.id;
  };

  // Territory memberships
  for (const u of USERS) {
    const isManager = u.key.startsWith("bm.") || u.key === "rsm";
    await prisma.territoryMember.createMany({
      data: u.territories.map((t) => ({
        userId: users.get(u.key)!,
        territoryId: territoryFor(t),
        isManager,
      })),
    });
  }

  // Shared customers: one corporate account + contact per fictitious customer (shared across brands).
  const customerIds = new Map<string, { accountId: string; contactId: string }>();
  for (const [i, name] of CUSTOMERS.entries()) {
    const account = await prisma.account.create({
      data: {
        name,
        type: "CORPORATE",
        industry: "General",
        city: REGIONS[i % REGIONS.length],
        phone: `+234700000${String(2000 + i)}`,
        email: `accounts${i}@example.test`,
        address: `${i + 1} Example Road`,
        rcNumber: `RC${100000 + i}`,
        creditLimit: 50_000_000 + i * 5_000_000,
        kycStatus: i % 3 === 0 ? "VERIFIED" : "PENDING",
      },
    });
    const contact = await prisma.contact.create({
      data: {
        accountId: account.id,
        firstName: "Buyer",
        lastName: name.split(" ")[0]!,
        mobile: `+234700000${String(3000 + i)}`,
        email: `buyer${i}@example.test`,
        city: REGIONS[i % REGIONS.length],
      },
    });
    await prisma.account.update({ where: { id: account.id }, data: { primaryContactId: contact.id } });
    customerIds.set(name, { accountId: account.id, contactId: contact.id });
  }

  // Stage ids per brand (the default pipeline is created by a DB trigger together with the brand).
  const stageId = new Map<string, string>();
  for (const p of await prisma.pipeline.findMany({ where: { isDefault: true }, include: { stages: true, brand: true } })) {
    for (const s of p.stages) stageId.set(`${p.brand.code}|${s.key}`, s.id);
  }

  // Demo deals: 5 per active brand × region, owned by a member of that territory.
  let n = 0;
  const baseDate = Date.UTC(2026, 9, 1);
  for (const code of ACTIVE_BRANDS) {
    for (const region of REGIONS) {
      const key = `${code}|${region}`;
      const owners = USERS.filter((u) => u.territories.includes(key) && u.role !== "Regional Sales Manager");
      const ownerKeys = owners.length ? owners.map((u) => u.key) : ["rsm"];
      for (let i = 0; i < DEALS_PER_BRAND_REGION; i++) {
        const customer = CUSTOMERS[n % CUSTOMERS.length]!;
        const vehicle = VEHICLE_TYPES[i % VEHICLE_TYPES.length]!;
        const ownerId = users.get(ownerKeys[i % ownerKeys.length]!)!;
        await prisma.deal.create({
          data: {
            name: `${code} ${vehicle} – ${customer}`,
            customerName: customer,
            accountId: customerIds.get(customer)!.accountId,
            contactId: customerIds.get(customer)!.contactId,
            amount: 18_000_000 + ((n * 7_350_000) % 60_000_000),
            stageId: stageId.get(`${code}|${DEAL_STAGES[(n + i) % DEAL_STAGES.length]}`)!,
            stageEnteredAt: new Date(baseDate - ((n * 5) % 30) * 86_400_000),
            modelId: null,
            closeDate: new Date(baseDate + ((n * 3) % 90) * 86_400_000),
            brandId: brands.get(code)!,
            regionId: regions.get(region)!,
            territoryId: territoryFor(key),
            ownerId,
            createdById: ownerId,
            updatedById: ownerId,
          },
        });
        n++;
      }
    }
  }

  // Catalogue: 3 models × 2 variants per active brand, a default price book and a few stock references.
  const products = new Map<string, string[]>();
  for (const [bi, code] of ACTIVE_BRANDS.entries()) {
    const brandId = brands.get(code)!;
    const book = await prisma.priceBook.create({
      data: { brandId, name: "2026 Standard Price List", validFrom: new Date(Date.UTC(2026, 0, 1)), validTo: new Date(Date.UTC(2026, 11, 31)), isDefault: true },
    });
    const ids: string[] = [];
    for (const m of CATALOGUE_MODELS) {
      for (const v of CATALOGUE_VARIANTS) {
        const listPrice = Math.round((m.base * v.factor * (1 + bi * 0.03)) / 50_000) * 50_000;
        const p = await prisma.product.create({
          data: {
            brandId,
            code: `${code}-${m.model.toUpperCase()}-${v.variant.slice(0, 3).toUpperCase()}`,
            name: `${code} ${m.model} ${v.variant}`,
            model: `${code} ${m.model}`,
            variant: v.variant,
            category: "VEHICLE",
            modelYear: 2026,
            bodyType: m.bodyType,
            fuel: "Petrol",
            transmission: v.transmission,
            engineCc: m.engineCc,
            colours: CATALOGUE_COLOURS,
            listPrice,
            description: `Fictitious ${m.bodyType.toLowerCase()} for demo data.`,
          },
        });
        ids.push(p.id);
        await prisma.priceBookEntry.create({ data: { priceBookId: book.id, productId: p.id, price: listPrice, maxDiscountPct: v.variant === "Premium" ? 5 : 3 } });
      }
    }
    products.set(code, ids);
  }

  // Inventory (prompt 16): warehouses, vendors, vehicles by VIN, parts, one shipment with landed cost.
  await seedInventory(prisma, { brands, regions, products, activeBrands: ACTIVE_BRANDS, baseDate });

  // Default assignment rule (BUSINESS_CONTEXT §10): round-robin within the Brand–Region territory.
  await prisma.assignmentRule.create({
    data: { name: "Default – round-robin in Brand–Region", position: 1000, action: "ROUND_ROBIN" },
  });

  // Leads: 3 per active brand × region, owned by members of that territory.
  let m = 0;
  for (const code of ACTIVE_BRANDS) {
    for (const region of REGIONS) {
      const key = `${code}|${region}`;
      const owners = USERS.filter((u) => u.territories.includes(key) && u.role !== "Regional Sales Manager");
      const ownerKeys = owners.length ? owners.map((u) => u.key) : ["rsm"];
      for (let i = 0; i < LEADS_PER_BRAND_REGION; i++) {
        const [first, last] = LEAD_PEOPLE[m % LEAD_PEOPLE.length]!;
        const status = LEAD_STATUSES_SEED[m % LEAD_STATUSES_SEED.length] as LeadStatus;
        const ownerId = users.get(ownerKeys[(m + i) % ownerKeys.length]!)!;
        await prisma.lead.create({
          data: {
            firstName: first,
            lastName: `${last} ${code}`,
            mobile: `+234700000${String(1000 + m).padStart(4, "0")}`,
            email: `lead${m}@example.test`,
            city: region,
            source: LEAD_SOURCES_SEED[m % LEAD_SOURCES_SEED.length] as LeadSource,
            status,
            unqualifiedReason: status === "UNQUALIFIED" ? "Budget too low" : null,
            rating: RATINGS_SEED[m % RATINGS_SEED.length] as LeadRating,
            modelOfInterestId: products.get(code)![m % products.get(code)!.length],
            budget: 15_000_000 + ((m * 2_500_000) % 40_000_000),
            brandId: brands.get(code)!,
            regionId: regions.get(region)!,
            territoryId: territoryFor(key),
            ownerId,
            createdById: ownerId,
            updatedById: ownerId,
            createdAt: new Date(baseDate - (m % 20) * 86_400_000),
          },
        });
        m++;
      }
    }
  }
}

async function main() {
  const prisma = new PrismaClient();
  try {
    await seed(prisma);
    console.log("Seeded fictitious data.");
  } finally {
    await prisma.$disconnect();
  }
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
