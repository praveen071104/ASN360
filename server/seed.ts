import { MongoClient } from 'mongodb';
import { mockAsnData } from '../src/data/mockAsnData.ts';
import type { AsnJourney } from '../src/types/asn';
import { createMongoClient, databaseName, journeysCollection } from './db';

async function seedMockJourneys(client: MongoClient) {
  const journeys = journeysCollection(client);
  await journeys.createIndex({ asnId: 1 }, { unique: true });
  const operations = mockAsnData.map((journey: AsnJourney) => ({
    replaceOne: {
      filter: { asnId: journey.asnId },
      replacement: journey,
      upsert: true,
    },
  }));
  const result = await journeys.bulkWrite(operations, { ordered: true });
  console.info(
    `Seeded ${mockAsnData.length} synthetic ASN journeys in "${databaseName}" `
      + `(${result.upsertedCount} inserted, ${result.modifiedCount} updated).`,
  );
}

async function run() {
  const client = createMongoClient();
  try {
    await client.connect();
    await seedMockJourneys(client);
  } finally {
    await client.close();
  }
}

void run().catch((error: unknown) => {
  console.error('Mock-data seeding failed. Confirm MongoDB is running and MONGODB_URI is correct.', error);
  process.exitCode = 1;
});
