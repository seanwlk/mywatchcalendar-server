import { Controller, Delete, Get, Param, Post, Patch, Body, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SeriesService } from './series.service';
import { SeriesPaginationQueryDto } from './dto/pagination-query.dto';
import { UpdateSeriesStatusDto, SeriesStatusDto } from './dto/status.dto';
import { MarkWatchedDto } from './dto/mark-watched.dto'

@Controller('series')
@UseGuards(AuthGuard('jwt'))
export class SeriesController {
  constructor(private readonly seriesService: SeriesService) {}

  @Get('unwatched')
  async getUnwatched(@Req() req: any, @Query() query: SeriesPaginationQueryDto) {
    return this.seriesService.getUnwatched(req.user.id, query.page ?? 1, query.pageSize ?? 30);
  }

  @Get('calendar')
  async getCalendar(@Req() req: any, @Query() query: SeriesPaginationQueryDto, @Query('direction') direction: 'past' | 'future' = 'future',) {
    return this.seriesService.getCalendar(req.user.id, query.page ?? 1, query.pageSize ?? 30, direction);
  }

  @Get('followed')
  async getFollowed(@Req() req: any, @Query() query: SeriesPaginationQueryDto) {
    return this.seriesService.getFollowed(req.user.id, query.page ?? 1, query.pageSize ?? 30);
  }
  
  @Get('search')
  async search(@Req() req: any, @Query('q') q: string, @Query() query: SeriesPaginationQueryDto) {
    return this.seriesService.search(req.user.id, q ?? '', query.page ?? 1, query.pageSize ?? 30);
  }

  @Get(':id')
  async getSeries(@Req() req: any, @Param('id') id: string) {
    return this.seriesService.getSeriesDetails(req.user.id, id);
  }

  @Post(':id/follow')
  async followSeries(@Req() req: any, @Param('id') id: string) {
    return this.seriesService.followSeries(req.user.id, id);
  }

  @Delete(':id/follow')
  async unfollow(@Req() req: any, @Param('id') id: string) {
    return this.seriesService.unfollowSeries(req.user.id, id);
  }

  @Patch(':id/status')
  async updateStatus(@Req() req: any, @Param('id') id: string, @Body() body: UpdateSeriesStatusDto) {
    return this.seriesService.updateSeriesStatus(req.user.id, id, body.status as SeriesStatusDto);
  }

  @Get(':id/next-unwatched-episode')
  async getNextUnwatchedEpisode(@Req() req: any, @Param('id') id: string) {
    return this.seriesService.getNextUnwatchedEpisode(req.user.id, id);
  }
}

@Controller('episodes')
@UseGuards(AuthGuard('jwt'))
export class EpisodeController {
  constructor(private readonly seriesService: SeriesService) {}

  @Get(':id')
  async getEpisode(@Req() req: any, @Param('id') id: string) {
    return this.seriesService.getEpisodeDetails(req.user.id, id);
  }

  @Post(':id/mark-watched')
  async markWatched(@Req() req: any, @Param('id') id: string, @Body() body: MarkWatchedDto) {
    return this.seriesService.markWatched(req.user.id, id, body?.watchedAt);
  }

  @Delete(':id/mark-watched')
  async unmarkWatched(@Req() req: any, @Param('id') id: string) {
    return this.seriesService.unmarkWatched(req.user.id, id);
  }
}
