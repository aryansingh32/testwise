import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { Permission } from '@testwise/shared';
import { AdminActor, AdminAuthGuard, RequirePermission } from '../common/auth.guards';
import type { AuditActor } from '../common/audit.service';
import { AppConfigService } from './app-config.service';

@Controller('v1/app')
export class PublicConfigController {
  constructor(private readonly config: AppConfigService) {}

  /** Settings the student app needs before login (login methods, maintenance, flags). */
  @Get('config')
  getPublic() {
    return this.config.getPublic();
  }
}

@Controller('v1/admin/config')
@UseGuards(AdminAuthGuard)
export class AdminConfigController {
  constructor(private readonly config: AppConfigService) {}

  @Get()
  @RequirePermission(Permission.CONFIG_READ)
  list() {
    return this.config.listForAdmin();
  }

  @Get(':key/history')
  @RequirePermission(Permission.CONFIG_READ)
  history(@Param('key') key: string) {
    return this.config.history(key);
  }

  @Put(':key')
  @RequirePermission(Permission.CONFIG_WRITE)
  update(@Param('key') key: string, @Body() body: { value: unknown }, @AdminActor() actor: AuditActor) {
    return this.config.update(key, body?.value, actor);
  }
}
