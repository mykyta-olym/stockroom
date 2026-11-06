import { recreateDatabase } from '../support/database';
import { TEST_DATABASE_URL } from './helpers';

export default async function setup(): Promise<void> {
  await recreateDatabase(TEST_DATABASE_URL);
}
