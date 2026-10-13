import { Controller, Get, Headers, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PaymentsService } from './payments/payments.service';
import { ResultsService } from './results/results.service';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

@Controller()
export class PublicController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly results: ResultsService,
  ) {}

  /** Gateway webhooks. Signature is verified against the raw body. */
  @Post('v1/payments/webhooks/:provider')
  @HttpCode(200)
  webhook(@Param('provider') provider: string, @Req() req: Request & { rawBody?: Buffer }, @Headers() headers: Record<string, string>) {
    return this.payments.handleWebhook(provider, req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {})), headers);
  }

  @Get('v1/results/verify/:code')
  verifyJson(@Param('code') code: string) {
    return this.results.verify(code);
  }

  /** Public, shareable verification page for official results. */
  @Get('verify/:code')
  async verifyPage(@Param('code') code: string, @Res() res: Response) {
    try {
      const v = await this.results.verify(code);
      const rows = v.entries
        .map((e) => `<tr><td>${esc(e.rank)}</td><td>${esc(e.name)}</td><td>${esc(e.score)}</td><td>${esc(e.accuracy)}%</td><td>${esc(e.reward ?? '—')}</td></tr>`)
        .join('');
      res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(v.tournament)} · Verified results</title>
<style>body{font-family:system-ui,sans-serif;margin:0;background:#050A1A;color:#fff}main{max-width:720px;margin:auto;padding:24px 16px}
.badge{display:inline-block;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;background:${v.status === 'FINAL' ? '#10B981' : '#F59E0B'};color:#111}
table{width:100%;border-collapse:collapse;margin-top:16px;background:#0F1B3D;border-radius:12px;overflow:hidden}th,td{padding:10px;text-align:left;font-size:14px;border-bottom:1px solid #ffffff14}th{color:#ffffffa0;font-size:12px;text-transform:uppercase}
small{color:#ffffff80}</style></head><body><main>
<p style="color:#F59E0B;font-weight:800">Testwise</p><h1>${esc(v.tournament)}</h1>
<span class="badge">${v.status === 'FINAL' ? 'OFFICIAL RESULT' : esc(v.status)}</span>
<p><small>Version ${esc(v.version)} · published ${esc(new Date(v.publishedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))} IST · code ${esc(code)}</small></p>
<table><thead><tr><th>Rank</th><th>Student</th><th>Score</th><th>Accuracy</th><th>Reward</th></tr></thead><tbody>${rows}</tbody></table>
<p><small>This page is generated from Testwise's official result records. Names of students under 18 are shortened for privacy.</small></p>
</main></body></html>`);
    } catch {
      res.status(404).type('html').send('<!doctype html><title>Not found</title><p style="font-family:sans-serif">No result found for this verification code.</p>');
    }
  }
}
