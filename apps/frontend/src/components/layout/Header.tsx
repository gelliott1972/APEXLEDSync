import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Languages, LogOut, User, LayoutDashboard, Activity, Users, Moon, Sun } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useUIStore } from '@/stores/ui-store';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function Header() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuthStore();
  const { isWorking, activity, endSession } = useSessionStore();
  const { theme, toggleTheme } = useUIStore();

  const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('language', lang);
  };

  const handleLogout = async () => {
    if (isWorking) {
      await endSession();
    }
    await logout();
  };

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : '?';

  const isAdmin = user?.role === 'admin';

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center justify-center rounded-md p-2 text-sm font-medium transition-colors',
      isActive
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
    );

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center gap-4 px-4">
        {/* Logo */}
        <h1 className="text-lg font-bold whitespace-nowrap">UniSync</h1>

        {/* Navigation - grows to fill space */}
        <nav className="flex items-center gap-1">
          <NavLink to="/" className={navLinkClass} title={t('nav.dashboard')}>
            <LayoutDashboard className="h-5 w-5" />
            <span className="ml-2 hidden lg:inline">{t('nav.dashboard')}</span>
          </NavLink>
          <NavLink to="/status-board" className={navLinkClass} title={t('nav.statusBoard')}>
            <Activity className="h-5 w-5" />
            <span className="ml-2 hidden lg:inline">{t('nav.statusBoard')}</span>
          </NavLink>
          {isAdmin && (
            <NavLink to="/admin" className={navLinkClass} title={t('nav.admin')}>
              <Users className="h-5 w-5" />
              <span className="ml-2 hidden lg:inline">{t('nav.admin')}</span>
            </NavLink>
          )}
        </nav>

        {/* Working badge */}
        {isWorking && (
          <Badge variant="in_progress" className="hidden sm:flex whitespace-nowrap">
            {activity}
          </Badge>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right side actions */}
        <div className="flex items-center gap-1">
          {/* Theme Toggle */}
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={toggleTheme}>
            {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
            <span className="sr-only">Toggle theme</span>
          </Button>

          {/* Language Selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-9 gap-1 px-2">
                <Languages className="h-5 w-5" />
                <span className="text-xs font-medium uppercase">
                  {i18n.language === 'zh-TW' ? 'TW' : i18n.language.toUpperCase()}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => changeLanguage('en')}>
                English {i18n.language === 'en' && '✓'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => changeLanguage('zh')}>
                简体中文 {i18n.language === 'zh' && '✓'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => changeLanguage('zh-TW')}>
                繁體中文 {i18n.language === 'zh-TW' && '✓'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">{user?.name}</p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {user?.email}
                  </p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {t(`roles.${user?.role}`)}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <User className="mr-2 h-4 w-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                {t('auth.logout')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
