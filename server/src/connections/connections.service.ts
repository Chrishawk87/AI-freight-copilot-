import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret } from '../common/secret';
import { ConnectorContext } from './connector';
import { getConnector, isLiveConnector } from './registry';

// What the client is allowed to see about a connection. Credentials NEVER leave
// the server — only whether one is on file.
export type ConnectionView = {
  provider: string;
  status: string; // pending | connected | error | disabled
  live: boolean; // does a real integration back this provider?
  liveSync: boolean; // has it pulled this carrier's data?
  hasCredential: boolean;
  config: any;
  lastSyncedAt: Date | null;
  lastError: string;
  updatedAt: Date;
};

@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger('Connections');

  constructor(private readonly prisma: PrismaService) {}

  private view(row: any): ConnectionView {
    return {
      provider: row.provider,
      status: row.status,
      live: isLiveConnector(row.provider),
      liveSync: row.liveSync,
      hasCredential: !!row.credentials,
      config: row.config ?? null,
      lastSyncedAt: row.lastSyncedAt ?? null,
      lastError: row.lastError ?? '',
      updatedAt: row.updatedAt,
    };
  }

  async list(carrierId: string): Promise<ConnectionView[]> {
    const rows = await this.prisma.connection.findMany({
      where: { carrierId },
      orderBy: { provider: 'asc' },
    });
    return rows.map((r) => this.view(r));
  }

  private decodeCreds(stored: string): Record<string, any> {
    if (!stored) return {};
    try {
      return JSON.parse(decryptSecret(stored)) ?? {};
    } catch {
      return {};
    }
  }

  private buildContext(row: any): ConnectorContext {
    return {
      carrierId: row.carrierId,
      creds: this.decodeCreds(row.credentials),
      config: row.config ?? null,
      prisma: this.prisma,
    };
  }

  // Connect (or update) a provider for a carrier: validate, encrypt, persist,
  // then run an initial sync. Returns the sanitized view.
  async connect(
    carrierId: string,
    provider: string,
    opts: { credentials?: Record<string, any>; config?: Record<string, any>; label?: string },
  ): Promise<ConnectionView> {
    const connector = getConnector(provider, opts.label);
    const existing = await this.prisma.connection.findUnique({
      where: { carrierId_provider: { carrierId, provider } },
    });

    // Merge new credentials over any already on file (lets the client send only
    // changed fields, or none to just re-enable).
    const creds = {
      ...this.decodeCreds(existing?.credentials ?? ''),
      ...(opts.credentials ?? {}),
    };
    // Drop blank values so an empty field doesn't clobber a saved secret.
    for (const k of Object.keys(creds)) {
      if (typeof creds[k] === 'string' && creds[k].trim() === '') delete creds[k];
    }

    const ctx: ConnectorContext = {
      carrierId,
      creds,
      config: (opts.config ?? existing?.config ?? null) as Record<string, any> | null,
      prisma: this.prisma,
    };

    const test = await connector.test(ctx);
    const encrypted = Object.keys(creds).length ? encryptSecret(JSON.stringify(creds)) : '';

    const row = await this.prisma.connection.upsert({
      where: { carrierId_provider: { carrierId, provider } },
      create: {
        carrierId,
        provider,
        status: test.ok ? 'connected' : 'error',
        credentials: encrypted,
        config: ctx.config ?? undefined,
        lastError: test.ok ? '' : test.message ?? 'Could not connect',
      },
      update: {
        status: test.ok ? 'connected' : 'error',
        credentials: encrypted,
        config: ctx.config ?? undefined,
        lastError: test.ok ? '' : test.message ?? 'Could not connect',
      },
    });

    if (test.ok) {
      // Populate this carrier's data right away.
      await this.runSync(row).catch((e) =>
        this.logger.warn(`Initial sync for ${provider} failed: ${e?.message}`),
      );
      const fresh = await this.prisma.connection.findUnique({
        where: { carrierId_provider: { carrierId, provider } },
      });
      return this.view(fresh ?? row);
    }
    return this.view(row);
  }

  async disconnect(carrierId: string, provider: string): Promise<ConnectionView | null> {
    const existing = await this.prisma.connection.findUnique({
      where: { carrierId_provider: { carrierId, provider } },
    });
    if (!existing) return null;
    const row = await this.prisma.connection.update({
      where: { carrierId_provider: { carrierId, provider } },
      data: { status: 'disabled', liveSync: false },
    });
    return this.view(row);
  }

  // Run a single connection's sync and record the outcome.
  private async runSync(row: any): Promise<void> {
    const connector = getConnector(row.provider);
    const ctx = this.buildContext(row);
    try {
      const result = await connector.sync(ctx);
      await this.prisma.connection.update({
        where: { id: row.id },
        data: {
          liveSync: connector.live && result.ok,
          lastSyncedAt: new Date(),
          lastError: result.ok ? '' : result.message ?? 'Sync failed',
          status: result.ok ? 'connected' : 'error',
        },
      });
    } catch (e: any) {
      await this.prisma.connection.update({
        where: { id: row.id },
        data: { status: 'error', lastError: e?.message ?? 'Sync error' },
      });
      throw e;
    }
  }

  async syncOne(carrierId: string, provider: string): Promise<ConnectionView | null> {
    const row = await this.prisma.connection.findUnique({
      where: { carrierId_provider: { carrierId, provider } },
    });
    if (!row) return null;
    await this.runSync(row).catch(() => undefined);
    const fresh = await this.prisma.connection.findUnique({
      where: { carrierId_provider: { carrierId, provider } },
    });
    return fresh ? this.view(fresh) : null;
  }

  // Sync every connected provider for a carrier. Called on connect and on login
  // so a carrier's data populates the moment they sign in. Runs isolated per
  // carrier, so it scales to thousands without cross-tenant work.
  async syncCarrier(carrierId: string): Promise<void> {
    const rows = await this.prisma.connection.findMany({
      where: { carrierId, status: 'connected' },
    });
    for (const row of rows) {
      await this.runSync(row).catch((e) =>
        this.logger.warn(`Sync ${row.provider} for ${carrierId}: ${e?.message}`),
      );
    }
  }
}
