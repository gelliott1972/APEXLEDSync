import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { signIn, signOut, confirmSignIn, fetchUserAttributes, getCurrentUser } from 'aws-amplify/auth';
import { useAuthStore } from '@/stores/auth-store';
import type { UserRole, Language } from '@unisync/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const newPasswordSchema = z.object({
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

type LoginForm = z.infer<typeof loginSchema>;
type NewPasswordForm = z.infer<typeof newPasswordSchema>;

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setUser, clearError, isAuthenticated } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsNewPassword, setNeedsNewPassword] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  const loginForm = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const newPasswordForm = useForm<NewPasswordForm>({
    resolver: zodResolver(newPasswordSchema),
  });

  // Check for existing session on mount
  useEffect(() => {
    const checkExistingSession = async () => {
      try {
        // If already authenticated in store, redirect
        if (isAuthenticated) {
          navigate('/');
          return;
        }
        // Check if there's a Cognito session
        await getCurrentUser();
        // If we get here, user has a valid session - sign them out so they can log in fresh
        await signOut();
      } catch {
        // No existing session, that's fine
      } finally {
        setCheckingSession(false);
      }
    };
    checkExistingSession();
  }, [isAuthenticated, navigate]);

  const onLoginSubmit = async (data: LoginForm) => {
    setIsLoading(true);
    setError(null);
    clearError();

    try {
      const result = await signIn({ username: data.email, password: data.password });

      if (result.nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        // User needs to set a new password (first login with temp password)
        setNeedsNewPassword(true);
        setIsLoading(false);
        return;
      }

      // Normal login - fetch user and redirect
      await completeLogin(data.email);
    } catch (err) {
      console.error('Login error:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Handle "already signed in" error by signing out and retrying
      if (errorMessage.toLowerCase().includes('already') && errorMessage.toLowerCase().includes('sign')) {
        try {
          await signOut();
          // Retry the login
          const result = await signIn({ username: data.email, password: data.password });
          if (result.nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
            setNeedsNewPassword(true);
            setIsLoading(false);
            return;
          }
          await completeLogin(data.email);
          return;
        } catch (retryErr) {
          console.error('Retry login error:', retryErr);
          setError(retryErr instanceof Error ? retryErr.message : t('errors.loginFailed'));
        }
      } else {
        setError(errorMessage);
      }
      setIsLoading(false);
    }
  };

  const onNewPasswordSubmit = async (data: NewPasswordForm) => {
    setIsLoading(true);
    setError(null);

    try {
      await confirmSignIn({ challengeResponse: data.newPassword });
      await completeLogin(loginForm.getValues('email'));
    } catch (err) {
      console.error('Set password error:', err);
      setError(err instanceof Error ? err.message : 'Failed to set new password');
      setIsLoading(false);
    }
  };

  const completeLogin = async (email: string) => {
    const attributes = await fetchUserAttributes();
    const role = (attributes['custom:role'] as UserRole) ?? 'viewer';

    setUser({
      userId: attributes['custom:userId'] ?? attributes.sub ?? '',
      email: attributes.email ?? email,
      name: attributes.name ?? email,
      role,
      preferredLang: (attributes['custom:preferredLang'] as Language) ?? 'en',
      canEditVersions: role === 'admin' ? true : attributes['custom:canEditVersions'] === 'true',
    });

    navigate('/');
  };

  // Show loading while checking for existing session
  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">{t('common.loading')}...</div>
      </div>
    );
  }

  if (needsNewPassword) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-2xl font-bold">UniSync</CardTitle>
            <CardDescription>{t('auth.setNewPassword')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={newPasswordForm.handleSubmit(onNewPasswordSubmit)} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t('auth.newPasswordRequired')}
              </p>

              <div className="space-y-2">
                <Label htmlFor="newPassword">{t('auth.newPassword')}</Label>
                <Input
                  id="newPassword"
                  type="password"
                  {...newPasswordForm.register('newPassword')}
                  disabled={isLoading}
                />
                {newPasswordForm.formState.errors.newPassword && (
                  <p className="text-sm text-destructive">
                    {newPasswordForm.formState.errors.newPassword.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">{t('auth.confirmPassword')}</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  {...newPasswordForm.register('confirmPassword')}
                  disabled={isLoading}
                />
                {newPasswordForm.formState.errors.confirmPassword && (
                  <p className="text-sm text-destructive">
                    {newPasswordForm.formState.errors.confirmPassword.message}
                  </p>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                {t('auth.passwordRequirements')}
              </p>

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? t('common.loading') : t('auth.setPassword')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl font-bold">UniSync</CardTitle>
          <CardDescription>{t('auth.signInToContinue')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@example.com"
                {...loginForm.register('email')}
                disabled={isLoading}
              />
              {loginForm.formState.errors.email && (
                <p className="text-sm text-destructive">{loginForm.formState.errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t('auth.password')}</Label>
              <Input
                id="password"
                type="password"
                {...loginForm.register('password')}
                disabled={isLoading}
              />
              {loginForm.formState.errors.password && (
                <p className="text-sm text-destructive">{loginForm.formState.errors.password.message}</p>
              )}
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? t('common.loading') : t('auth.login')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
