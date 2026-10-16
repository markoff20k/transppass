import { useQuery } from '@tanstack/react-query';
import type { FailureCodeRule } from '@app/shared';
import { api } from '@/lib/api-client';

export interface FailureCodeValue {
  failureModeCode: string;
  subsystemCode: string;
  position: string;
}

export const EMPTY_FAILURE_CODE: FailureCodeValue = { failureModeCode: '', subsystemCode: '', position: '' };

export function useFailureRules() {
  return useQuery({
    queryKey: ['catalog', 'failure-rules'],
    queryFn: () => api.get<FailureCodeRule[]>('/catalog/failure-rules'),
    staleTime: 60_000,
  });
}

/** Converte o valor do picker nos campos opcionais que a API aceita. */
export function toCodeFields(value: FailureCodeValue, prefix: '' | 'confirmed' = '') {
  if (!value.failureModeCode || !value.subsystemCode) return {};
  if (prefix === 'confirmed') {
    return {
      confirmedFailureModeCode: value.failureModeCode,
      confirmedSubsystemCode: value.subsystemCode,
      confirmedPosition: value.position || undefined,
    };
  }
  return {
    failureModeCode: value.failureModeCode,
    subsystemCode: value.subsystemCode,
    position: value.position || undefined,
  };
}
