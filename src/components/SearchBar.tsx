import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';

interface SearchBarProps {
  onSearch: (query: string) => void;
  value?: string;
}

export default function SearchBar({ onSearch, value = '' }: SearchBarProps): React.JSX.Element {
  const { t } = useTranslation();
  const [query, setQuery] = useState(value);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      setQuery(v);
      onSearch(v);
    },
    [onSearch],
  );

  const handleClear = useCallback(() => {
    setQuery('');
    onSearch('');
  }, [onSearch]);

  return (
    <div className="relative" data-testid="search-bar">
      <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        value={query}
        onChange={handleChange}
        placeholder={t('search.placeholder')}
        className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-8 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="search-input"
      />
      {query.length > 0 && (
        <button
          onClick={handleClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          data-testid="search-clear"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
