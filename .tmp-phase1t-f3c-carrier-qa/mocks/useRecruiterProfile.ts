import { RECRUITER_ID } from '../fixtures';

export function useRecruiterProfile() {
  return {
    profile: { id: RECRUITER_ID, company_name: 'Continental Interstate Logistics & Freight Solutions LLC' },
    isLoading: false,
    isError: false,
  };
}
