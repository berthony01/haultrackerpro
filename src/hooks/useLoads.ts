import { useState, useEffect, useCallback } from 'react';
import { Load, calculateTotalPay, generateId } from '@/lib/types';

const STORAGE_KEY = 'haul-tracker-loads';

function getStoredLoads(): Load[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function storeLoads(loads: Load[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(loads));
}

export function useLoads() {
  const [loads, setLoads] = useState<Load[]>(getStoredLoads);

  useEffect(() => {
    storeLoads(loads);
  }, [loads]);

  const addLoad = useCallback((data: Omit<Load, 'id' | 'totalPay' | 'createdAt'>) => {
    const newLoad: Load = {
      ...data,
      id: generateId(),
      totalPay: calculateTotalPay(data),
      createdAt: new Date().toISOString(),
    };
    setLoads(prev => [newLoad, ...prev]);
    return newLoad;
  }, []);

  const updateLoad = useCallback((id: string, data: Omit<Load, 'id' | 'totalPay' | 'createdAt'>) => {
    setLoads(prev => prev.map(l => l.id === id ? {
      ...l,
      ...data,
      totalPay: calculateTotalPay(data),
    } : l));
  }, []);

  const deleteLoad = useCallback((id: string) => {
    setLoads(prev => prev.filter(l => l.id !== id));
  }, []);

  return { loads, addLoad, updateLoad, deleteLoad };
}
