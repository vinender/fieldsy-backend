//@ts-nocheck
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { JWT_SECRET } from '../config/constants';

const prisma = new PrismaClient();

export const authenticateAdmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // SECURITY FIX: Use consistent JWT_SECRET from constants
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const admin = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });
    
    if (!admin || admin.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    (req as any).userId = admin.id;
    (req as any).admin = admin;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};  
