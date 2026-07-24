import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (existing) {
      throw new BadRequestException('Username already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: { username: dto.username, name: dto.name, passwordHash },
    });

    const tokens = await this.issueTokens(user.id, user.username, user.isAdmin);
    return { user: this.sanitizeUser(user), ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.issueTokens(user.id, user.username, user.isAdmin);
    return { user: this.sanitizeUser(user), ...tokens };
  }

  async refresh(dto: RefreshTokenDto) {
    try {
      const payload = await this.jwtService.verifyAsync(dto.refreshToken, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
      });

      if (payload.type !== 'refresh' || !payload.sessionId || !payload.jti) {
        throw new UnauthorizedException('Refresh token is invalid');
      }

      const session = await this.prisma.refreshTokenSession.findUnique({ where: { id: payload.sessionId } });
      if (!session || session.revokedAt || session.expiresAt < new Date()) {
        throw new UnauthorizedException('Refresh token is invalid or expired');
      }
      
      const isValid = await bcrypt.compare(payload.jti, session.tokenHash);
      if (!isValid) {
        throw new UnauthorizedException('Refresh token is invalid or expired');
      }

      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      await this.prisma.refreshTokenSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });

      const tokens = await this.issueTokens(user.id, user.username, user.isAdmin);
      return tokens;
    } catch (error) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }
  }

  async logout(dto: RefreshTokenDto) {
    try {
      const payload = await this.jwtService.verifyAsync(dto.refreshToken, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
        ignoreExpiration: true,
      });

      if (payload && payload.type === 'refresh' && payload.sessionId) {
        const session = await this.prisma.refreshTokenSession.findUnique({ 
          where: { id: payload.sessionId } 
        });

        if (session && !session.revokedAt) {
          await this.prisma.refreshTokenSession.update({
            where: { id: session.id },
            data: { revokedAt: new Date() },
          });
        }
      }
    } catch (error) {
    }
    
    return { success: true };
  }

  async changePassword(userId: string, newPassword: string) {
    const passwordHash = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    await this.prisma.refreshTokenSession.deleteMany({
      where: { userId },
    });

    return { message: 'Password updated successfully' };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return this.sanitizeUser(user);
  }

  private async issueTokens(userId: string, username: string, isAdmin: boolean) {

    const rawJti = randomBytes(32).toString('hex');
    const hashedToken = await this.hashToken(rawJti);

    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const session = await this.prisma.refreshTokenSession.create({
      data: {
        userId,
        expiresAt: refreshExpiresAt,
        tokenHash: hashedToken,
      },
    });

    const accessToken = await this.jwtService.signAsync(
      { sub: userId, username, isAdmin },
      {
        secret: this.configService.get('JWT_ACCESS_SECRET'),
        expiresIn: this.configService.get('JWT_ACCESS_EXPIRES_IN', '15m') as any,
      },
    );
    const refreshToken = await this.jwtService.signAsync(
      { sub: userId, type: 'refresh', sessionId: session.id, jti: rawJti },
      {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN', '7d') as any,
      },
    );

    return { accessToken, refreshToken };
  }

  private async hashToken(token: string) {
    return bcrypt.hash(token, 10);
  }

  private sanitizeUser(user: any) {
    if (!user) return null;
    const { passwordHash, ...rest } = user;
    return rest;
  }
}