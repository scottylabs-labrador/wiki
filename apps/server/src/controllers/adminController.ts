import { Get, Query, Route, Security, SuccessResponse } from "tsoa";

import { ADMIN_SCOPE, BEARER_AUTH, OIDC_AUTH } from "../lib/authentication.ts";
import { corpusService, type CorpusPage } from "../services/corpusService.ts";
import { userService } from "../services/userService.ts";

@Route("admin")
export class AdminController {
  @Get("users")
  @Security(OIDC_AUTH, [ADMIN_SCOPE])
  @Security(BEARER_AUTH, [ADMIN_SCOPE])
  @SuccessResponse(200)
  async listUsers(@Query() page?: number, @Query() limit?: number) {
    return userService.listUsers({
      ...(page !== undefined && { page }),
      ...(limit !== undefined && { limit }),
    });
  }

  @Get("pages")
  @Security(OIDC_AUTH, [ADMIN_SCOPE])
  @Security(BEARER_AUTH, [ADMIN_SCOPE])
  @SuccessResponse(200)
  async listPages(): Promise<CorpusPage[]> {
    return corpusService.listPages();
  }
}
