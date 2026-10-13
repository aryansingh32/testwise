import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface Exam {
  id: string;
  slug: string;
  nameEn: string;
  nameHi: string | null;
  category: 'SCHOOL' | 'COMPETITIVE';
  icon: string;
  color: string;
  sortOrder: number;
  active: boolean;
  _count?: { questions: number };
}

export interface Topic {
  id: string;
  subjectId: string;
  slug: string;
  nameEn: string;
  nameHi: string | null;
}

export interface Subject {
  id: string;
  slug: string;
  nameEn: string;
  nameHi: string | null;
  topics: Topic[];
  _count?: { questions: number };
}

export function useTaxonomy() {
  return useQuery({
    queryKey: ['taxonomy'],
    queryFn: () => api<{ exams: Exam[]; subjects: Subject[] }>('/v1/admin/taxonomy'),
    staleTime: 60_000,
  });
}
