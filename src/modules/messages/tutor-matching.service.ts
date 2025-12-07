import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Subject, Urgency } from '@prisma/client';

export interface MatchedTutor {
  id: string;
  userId: string;
  name: string;
  email: string;
  subjects: Subject[];
  rating: number;
  isAvailable: boolean;
  matchScore: number;
}

@Injectable()
export class TutorMatchingService {
  private readonly logger = new Logger(TutorMatchingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find the best matching tutor based on subject, availability, and rating
   */
  async findBestTutor(
    subject: Subject,
    urgency: Urgency,
    excludeTutorIds: string[] = [],
  ): Promise<MatchedTutor | null> {
    try {
      // Get all available tutors
      const tutors = await this.prisma.tutor.findMany({
        where: {
          isVerified: true,
          isAvailable: true,
          id: { notIn: excludeTutorIds },
        },
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
          // Count active conversations to check workload
          conversations: {
            where: {
              status: { in: ['PENDING', 'ASSIGNED', 'ACTIVE'] },
            },
          },
        },
        orderBy: [
          { rating: 'desc' },
          { experience: 'desc' },
        ],
      });

      if (tutors.length === 0) {
        this.logger.warn('No available tutors found');
        return null;
      }

      // Score each tutor
      const scoredTutors = tutors.map(tutor => {
        let score = 0;

        // Subject match bonus (highest priority)
        if (tutor.subjects.includes(subject)) {
          score += 100;
        } else if (tutor.subjects.includes(Subject.GENERAL)) {
          score += 30;
        }

        // Rating bonus
        score += (tutor.rating || 0) * 10;

        // Experience bonus
        score += (tutor.experience || 0) * 2;

        // Lower workload bonus (fewer active conversations = higher score)
        const activeConversations = tutor.conversations.length;
        score -= activeConversations * 5;

        // Urgency handling - prefer tutors with less workload for urgent requests
        if (urgency === Urgency.URGENT || urgency === Urgency.HIGH) {
          score -= activeConversations * 10;
        }

        return {
          id: tutor.id,
          userId: tutor.userId,
          name: tutor.user.name || 'Unknown',
          email: tutor.user.email,
          subjects: tutor.subjects,
          rating: tutor.rating || 0,
          isAvailable: tutor.isAvailable,
          matchScore: score,
        };
      });

      // Sort by score and return best match
      scoredTutors.sort((a, b) => b.matchScore - a.matchScore);
      
      const bestMatch = scoredTutors[0];
      this.logger.log(`Best tutor match: ${bestMatch.name} (score: ${bestMatch.matchScore})`);
      
      return bestMatch;
    } catch (error) {
      this.logger.error('Failed to find matching tutor', error);
      return null;
    }
  }

  /**
   * Get all available tutors for a subject
   */
  async getAvailableTutors(subject?: Subject): Promise<MatchedTutor[]> {
    const whereClause: any = {
      isVerified: true,
      isAvailable: true,
    };

    if (subject && subject !== Subject.GENERAL) {
      whereClause.subjects = { has: subject };
    }

    const tutors = await this.prisma.tutor.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: [
        { rating: 'desc' },
        { experience: 'desc' },
      ],
    });

    return tutors.map(tutor => ({
      id: tutor.id,
      userId: tutor.userId,
      name: tutor.user.name || 'Unknown',
      email: tutor.user.email,
      subjects: tutor.subjects,
      rating: tutor.rating || 0,
      isAvailable: tutor.isAvailable,
      matchScore: 0,
    }));
  }

  /**
   * Update tutor availability
   */
  async setTutorAvailability(tutorId: string, isAvailable: boolean): Promise<void> {
    await this.prisma.tutor.update({
      where: { id: tutorId },
      data: { isAvailable },
    });
  }
}

