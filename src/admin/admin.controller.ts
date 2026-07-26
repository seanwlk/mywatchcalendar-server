import { Controller, Get, Post, Put, Delete, Param, Body, ParseIntPipe, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { RequireAdmin } from './admin.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { SeriesSyncProducer } from '../jobs/series-sync/series-sync.producer';
import { CreateUserDto, UpdateUserDto, ResetPasswordDto } from './dto/admin-user.dto';

@Controller('admin')
@RequireAdmin()
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seriesSyncProducer: SeriesSyncProducer,
  ) {}

  @Get('users')
  async getAllUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        username: true,
        name: true,
        isAdmin: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  @Post('users')
  async createUser(@Body() dto: CreateUserDto) {
    const passwordHash = await bcrypt.hash(dto.password, 10);

    const newUser = await this.prisma.user.create({
      data: {
        username: dto.username,
        name: dto.name,
        passwordHash: passwordHash,
        isAdmin: dto.isAdmin ?? false,
      },
      select: { id: true, username: true, name: true, isAdmin: true },
    });

    return { message: 'User created successfully', user: newUser };
  }

  @Put('users/:id')
  async updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    try {
      const updatedUser = await this.prisma.user.update({
        where: { id },
        data: {
          ...(dto.username && { username: dto.username }),
          ...(dto.name && { name: dto.name }),
          ...(dto.isAdmin !== undefined && { isAdmin: dto.isAdmin }),
        },
        select: { id: true, username: true, name: true, isAdmin: true, updatedAt: true },
      });

      return { message: 'User updated successfully', user: updatedUser };
    } catch (error) {
      throw new NotFoundException('User not found');
    }
  }

  @Delete('users/:id')
  async deleteUser(@Param('id') id: string) {
    try {
      await this.prisma.user.delete({
        where: { id },
      });

      return { message: 'User deleted successfully' };
    } catch (error) {
      throw new NotFoundException('User not found');
    }
  }

  @Post('users/:id/reset-password')
  async resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto) {
    try {
      const passwordHash = await bcrypt.hash(dto.newPassword, 10);

      await this.prisma.user.update({
        where: { id },
        data: { passwordHash: passwordHash },
      });

      await this.prisma.refreshTokenSession.deleteMany({
        where: { userId: id },
      });

      return { message: 'Password reset successfully' };
    } catch (error) {
      throw new NotFoundException('User not found');
    }
  }

  @Post('sync/all')
  async syncAllSeries() {
    await this.seriesSyncProducer.fullMetadataSync();
    return { message: 'Full series metadata sync job has been added to the queue.' };
  }

  @Post('sync/upcoming')
  async syncUpcomingSeries() {
    await this.seriesSyncProducer.upcomingMetadataSync();
    return { message: 'Upcoming series metadata sync job has been added to the queue.' };
  }

  @Post('sync/:tmdbId')
  async syncSingleSeries(@Param('tmdbId', ParseIntPipe) tmdbId: number) {
    await this.seriesSyncProducer.syncSingleSeries(tmdbId);
    return { message: `Sync job for TMDB ID ${tmdbId} has been added to the queue.` };
  }
}