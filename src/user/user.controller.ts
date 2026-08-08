import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserService } from './user.service';

@Controller('user')
@UseGuards(AuthGuard('jwt'))
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('stats')
  async getStats(@Req() req: any) {
    return this.userService.getUserStats(req.user.id);
  }

  @Get('history')
  async getHistory(
    @Req() req: any,
    @Query('start') start: string,
    @Query('end') end: string,
  ) {
    return this.userService.getUserHistory(req.user.id, new Date(start), new Date(end));
  }
}