import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { SIMULATED_LOADS, SIMULATED_FUEL } from '../src/integrations/seed-loads';

const prisma = new PrismaClient();

async function main() {
  // ---- Demo carrier + user ----
  const demoEmail = 'demo@aifreight.co';
  let carrier = await prisma.carrier.findFirst({
    where: { companyName: 'Origin Management Solutions LLC' },
  });
  if (!carrier) {
    carrier = await prisma.carrier.create({
      data: {
        companyName: 'Origin Management Solutions LLC',
        dotNumber: '3921847',
        mcNumber: 'MC-1184402',
        insuranceProvider: 'Progressive Commercial',
        insuranceExpiry: '2027-02-28',
        w9OnFile: true,
        serviceAreas: JSON.stringify(['TX', 'OK', 'AR', 'LA', 'TN', 'GA', 'FL', 'AZ', 'CA']),
        mpg: 6.8,
        fixedCostPerMile: 0.72,
        drivers: {
          create: [
            { name: 'Chris H.', cdlClass: 'Class A', status: 'Active' },
            { name: 'Marcus D.', cdlClass: 'Class A', status: 'Active' },
          ],
        },
        equipment: {
          create: [
            { type: 'Reefer', unit: 'TRK-101', year: 2023 },
            { type: 'Dry Van', unit: 'TRK-102', year: 2021 },
            { type: 'Flatbed', unit: 'TRK-103', year: 2022 },
          ],
        },
      },
    });
  }

  const existingUser = await prisma.user.findUnique({ where: { email: demoEmail } });
  if (!existingUser) {
    await prisma.user.create({
      data: {
        name: 'Chris',
        email: demoEmail,
        passwordHash: await bcrypt.hash('demo1234', 10),
        role: 'owner_operator',
        carrierId: carrier.id,
      },
    });
    console.log('Created demo user  →  demo@aifreight.co / demo1234');
  }

  // ---- Loads ----
  for (const l of SIMULATED_LOADS) {
    await prisma.load.upsert({
      where: { externalId: l.externalId },
      create: { ...l, isReloadPool: l.isReloadPool ?? false },
      update: { rate: l.rate, demandIndex: l.demandIndex, reloadIndex: l.reloadIndex },
    });
  }
  console.log(`Seeded ${SIMULATED_LOADS.length} loads`);

  // ---- Fuel ----
  const fuelCount = await prisma.fuelStation.count();
  if (fuelCount === 0) {
    await prisma.fuelStation.createMany({ data: SIMULATED_FUEL });
    console.log(`Seeded ${SIMULATED_FUEL.length} fuel stations`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
