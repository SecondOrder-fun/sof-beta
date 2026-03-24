import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { languages } from '@/i18n/languages';
import { Globe, Download, Upload, Search, Save, AlertCircle } from 'lucide-react';

/**
 * Admin-only localization management interface
 * Allows viewing, editing, and exporting translation files
 */
const LocalizationAdmin = () => {
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [selectedNamespace, setSelectedNamespace] = useState('common');
  const [translations, setTranslations] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  const namespaces = ['common', 'navigation', 'raffle', 'market', 'admin', 'account', 'errors', 'transactions'];
  
  // Debug: Log to verify data is available
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log('Languages available:', languages.length, languages);
    // eslint-disable-next-line no-console
    console.log('Namespaces available:', namespaces.length, namespaces);
  }

  // Load translations for selected language and namespace
  const loadTranslations = useCallback(async () => {
    try {
      const response = await fetch(`/locales/${selectedLanguage}/${selectedNamespace}.json`);
      const data = await response.json();
      setTranslations(data);
      setHasChanges(false);
    } catch (error) {
      // Log error for debugging but don't crash the app
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.error('Failed to load translations:', error);
      }
      setTranslations({});
    }
  }, [selectedLanguage, selectedNamespace]);

  useEffect(() => {
    loadTranslations();
  }, [loadTranslations]);

  // Flatten nested translation object for table display
  const flattenTranslations = (obj, prefix = '') => {
    const flattened = [];
    for (const key in obj) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
        flattened.push(...flattenTranslations(obj[key], fullKey));
      } else {
        flattened.push({ key: fullKey, value: obj[key] });
      }
    }
    return flattened;
  };

  const flattenedTranslations = flattenTranslations(translations);

  // Filter translations based on search query
  const filteredTranslations = flattenedTranslations.filter(
    item =>
      item.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(item.value).toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleEdit = (key, value) => {
    setEditingKey(key);
    setEditValue(value);
  };

  const handleSaveEdit = () => {
    if (!editingKey) return;

    // Update the translations object
    const keys = editingKey.split('.');
    const newTranslations = { ...translations };
    let current = newTranslations;

    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) current[keys[i]] = {};
      current = current[keys[i]];
    }

    current[keys[keys.length - 1]] = editValue;
    setTranslations(newTranslations);
    setEditingKey(null);
    setEditValue('');
    setHasChanges(true);
  };

  const handleCancelEdit = () => {
    setEditingKey(null);
    setEditValue('');
  };

  const handleExport = () => {
    const dataStr = JSON.stringify(translations, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedLanguage}-${selectedNamespace}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        setTranslations(imported);
        setHasChanges(true);
      } catch (error) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.error('Failed to import translations:', error);
        }
        alert('Invalid JSON file');
      }
    };
    reader.readAsText(file);
  };

  const handleSaveAll = () => {
    // In a real implementation, this would save to the server
    // For now, we'll just export the file
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log('Saving translations:', translations);
    }
    alert('In production, this would save to the server. For now, use Export to download the file.');
    setHasChanges(false);
  };

  const getCompletionStatus = () => {
    const total = flattenedTranslations.length;
    const completed = flattenedTranslations.filter(
      item => item.value && !String(item.value).startsWith('[')
    ).length;
    return { completed, total, percentage: Math.round((completed / total) * 100) };
  };

  const status = getCompletionStatus();

  return (
    <div className="container mx-auto p-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Globe className="h-8 w-8" />
            Localization Management
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage translations across all supported languages
          </p>
        </div>
        {hasChanges && (
          <Badge variant="destructive" className="flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            Unsaved Changes
          </Badge>
        )}
      </div>

      {/* Controls */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Translation Controls</CardTitle>
          <CardDescription>Select language and namespace to manage translations</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Language</label>
              <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {languages.find(l => l.code === selectedLanguage)?.flag} {languages.find(l => l.code === selectedLanguage)?.nativeName || 'Select language'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {languages.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.flag} {lang.nativeName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Namespace</label>
              <Select value={selectedNamespace} onValueChange={setSelectedNamespace}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {selectedNamespace || 'Select namespace'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {namespaces.map((ns) => (
                    <SelectItem key={ns} value={ns}>
                      {ns}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Search</label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search keys or values..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Actions</label>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExport}
                  className="flex-1"
                >
                  <Download className="h-4 w-4 mr-1" />
                  Export
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById('import-file').click()}
                  className="flex-1"
                >
                  <Upload className="h-4 w-4 mr-1" />
                  Import
                </Button>
                <input
                  id="import-file"
                  type="file"
                  accept=".json"
                  onChange={handleImport}
                  className="hidden"
                />
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Badge variant="secondary">
                {status.completed} / {status.total} keys ({status.percentage}%)
              </Badge>
              <span className="text-sm text-muted-foreground">
                {filteredTranslations.length} keys displayed
              </span>
            </div>
            {hasChanges && (
              <Button onClick={handleSaveAll} className="flex items-center gap-2">
                <Save className="h-4 w-4" />
                Save Changes
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Translations Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            {selectedLanguage.toUpperCase()} - {selectedNamespace}
          </CardTitle>
          <CardDescription>
            Click on any value to edit. Changes are saved locally until you export or save.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-1/3">Key</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTranslations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      No translations found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredTranslations.map((item) => (
                    <TableRow key={item.key}>
                      <TableCell className="font-mono text-sm">{item.key}</TableCell>
                      <TableCell>
                        {editingKey === item.key ? (
                          <div className="flex gap-2">
                            <Textarea
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="min-h-[60px]"
                              autoFocus
                            />
                          </div>
                        ) : (
                          <div
                            className="cursor-pointer hover:bg-accent p-2 rounded"
                            onClick={() => handleEdit(item.key, item.value)}
                          >
                            {item.value}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {editingKey === item.key ? (
                          <div className="flex gap-1">
                            <Button size="sm" variant="default" onClick={handleSaveEdit}>
                              Save
                            </Button>
                            <Button size="sm" variant="outline" onClick={handleCancelEdit}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEdit(item.key, item.value)}
                          >
                            Edit
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default LocalizationAdmin;
