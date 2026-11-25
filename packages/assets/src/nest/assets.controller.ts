import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  Injectable,
  Inject,
  Optional,
  UploadedFile,
  UseInterceptors,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { CurrentUser, Public, RequirePermission, SessionAuthenticator, type RequestUser } from '@opencloudcms/oauth2';
import { ASSETS_OPTIONS, DEFAULT_MAX_BYTES } from '../constants';
import type { AssetsModuleOptions } from '../types';
import { AssetsService, type RegisterAssetInput, type UploadedFileInput } from './assets.service';
import { FoldersService } from './folders.service';

/** `FileInterceptor('file')` with the multer size limit taken from module options (multer error → 413). */
@Injectable()
export class AssetUploadInterceptor implements NestInterceptor {
  private readonly inner: NestInterceptor;
  constructor(@Optional() @Inject(ASSETS_OPTIONS) options: AssetsModuleOptions | null) {
    const Cls = FileInterceptor('file', { limits: { fileSize: options?.limits?.maxBytes ?? DEFAULT_MAX_BYTES, files: 1 } });
    this.inner = new Cls();
  }
  intercept(context: ExecutionContext, next: CallHandler) {
    return this.inner.intercept(context, next);
  }
}

@Controller('api/admin')
export class AssetsController {
  constructor(
    @Inject(AssetsService) private readonly assets: AssetsService,
    @Inject(FoldersService) private readonly folders: FoldersService,
    @Optional() @Inject(ASSETS_OPTIONS) private readonly assetsOptions: AssetsModuleOptions | null = null,
    @Optional() @Inject(SessionAuthenticator) private readonly sessions: SessionAuthenticator | null = null,
  ) {}

  @RequirePermission('content.read')
  @Get('asset-folders')
  listFolders() {
    return this.folders.list();
  }

  @RequirePermission('content.update')
  @Post('asset-folders')
  createFolder(@Body() body: { name?: string; parentId?: string | null }) {
    return this.folders.create(body);
  }

  @RequirePermission('content.update')
  @Patch('asset-folders/:id')
  patchFolder(@Param('id') id: string, @Body() body: { name?: string; parentId?: string | null }) {
    return this.folders.patch(id, body);
  }

  @RequirePermission('content.update')
  @Delete('asset-folders/:id')
  removeFolder(@Param('id') id: string) {
    return this.folders.delete(id);
  }

  /**
   * `folderId` omitted → all; `folderId=root` → root only; UUID → that folder.
   * `meta.uploadEnabled` is true only when the module was configured with a non-null `assets` option.
   */
  @RequirePermission('content.read')
  @Get('assets')
  async list(@Query('limit') limit = '50', @Query('folderId') folderId?: string, @Query('ids') ids?: string) {
    // `ids=a,b` (1–100 UUIDs): those assets only (missing omitted); limit/folderId are ignored.
    if (ids !== undefined) return { ...(await this.assets.byIds(AssetsService.parseIds(ids))), meta: { uploadEnabled: !!this.assetsOptions } };
    let filter: string | null | undefined;
    if (folderId === 'root') filter = null;
    else if (folderId != null && folderId !== '') filter = folderId;
    const res = await this.assets.list(Number(limit) || 50, filter);
    return { ...res, meta: { uploadEnabled: !!this.assetsOptions } };
  }

  @RequirePermission('content.update')
  @Post('assets')
  register(@Body() body: RegisterAssetInput) {
    return this.assets.register(body);
  }

  @RequirePermission('content.update')
  @Post('assets/bulk')
  bulk(@Body() body: { action?: string; ids?: string[]; folderId?: string | null }) {
    return this.assets.bulk(body);
  }

  @RequirePermission('content.update')
  @Patch('assets/:id')
  patch(@Param('id') id: string, @Body() body: { alt?: string | null; folderId?: string | null }) {
    return this.assets.patch(id, body);
  }

  @RequirePermission('content.update')
  @Delete('assets/:id')
  remove(@Param('id') id: string) {
    return this.assets.delete(id);
  }

  /**
   * Private file download (spec §7): `content.read` (the owner type's read permission) with a session, or a valid
   * signed `?token=` from `POST assets/:id/link` without one. Public because the token path has no session; the
   * session path is checked here exactly as the guard would.
   */
  @Public()
  @Get('assets/:id/file')
  async download(@Param('id') id: string, @Query('token') token: string | undefined, @Req() req: Request, @Res() res: Response) {
    if (token !== undefined) {
      if (!this.assets.verifyLink(id, String(token))) throw new ForbiddenException({ code: 'forbidden', message: 'Invalid or expired link' });
    } else {
      const user = this.sessions
        ? await this.sessions.authenticate(req, res)
        : ((req as Request & { user?: Pick<RequestUser, 'permissions'> }).user ?? null);
      if (!user) throw new UnauthorizedException({ code: 'unauthenticated', message: 'Authentication required' });
      if (!user.permissions.includes('content.read')) throw new ForbiddenException({ code: 'forbidden', message: 'Missing permission: content.read' });
    }
    const { asset, stream } = await this.assets.openPrivate(id);
    res.setHeader('Content-Type', asset.mimeType ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeRFC5987(asset.filename)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    if (asset.size != null) res.setHeader('Content-Length', String(asset.size));
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  /** A 5-minute signed download URL for links that cannot send headers (decision 15). */
  @RequirePermission('content.read')
  @Post('assets/:id/link')
  link(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.assets.createLink(id, user.id);
  }
}

/** RFC 5987 `ext-value` encoding (`encodeURIComponent` plus the characters it leaves that are not attr-chars). */
function encodeRFC5987(s: string): string {
  return encodeURIComponent(s).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Only registered when the `assets` option is non-null. */
@Controller('api/admin')
export class AssetsUploadController {
  constructor(@Inject(AssetsService) private readonly assets: AssetsService) {}

  @RequirePermission('content.update')
  @Post('assets/upload')
  @UseInterceptors(AssetUploadInterceptor)
  upload(
    @UploadedFile() file: UploadedFileInput | undefined,
    @Body('alt') alt?: string,
    @Body('folderId') folderId?: string,
  ) {
    if (!file) throw new BadRequestException('file is required (multipart field "file")');
    return this.assets.upload(file, {
      alt,
      folderId: folderId === '' || folderId === 'root' ? null : folderId,
    });
  }
}

/**
 * Delivery API (`/api/content/**` is public): `GET /api/content/assets?ids=a,b` → `{ data: [{ id, url, alt, width,
 * height, mimeType }] }` for the existing assets among 1–100 UUIDs (400 otherwise). Used by `resolvePage` to render
 * asset fields of entries. Not registered by `AssetsModule`: the host lists it before its `api/content/:apiId` route
 * (Express matches in registration order). Shadows a content type with apiId `assets` on the delivery API.
 */
@Controller('api/content')
export class PublicAssetsController {
  constructor(@Inject(AssetsService) private readonly assets: AssetsService) {}

  @Get('assets')
  byIds(@Query('ids') ids?: string) {
    return this.assets.publicByIds(AssetsService.parseIds(ids));
  }
}
