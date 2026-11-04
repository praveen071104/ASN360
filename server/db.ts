import { MongoClient, type Collection } from 'mongodb';
import type { AsnJourney } from '../src/types/asn';

export const mongoUri = process.env.MONGODB_URI?.trim() || 'mongodb://127.0.0.1:27017';
export const databaseName = process.env.MONGODB_DB?.trim() || 'asn360_control_tower';

export function createMongoClient() {
  return new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
}

export function journeysCollection(client: MongoClient): Collection<AsnJourney> {
  return client.db(databaseName).collection<AsnJourney>('journeys');
}
