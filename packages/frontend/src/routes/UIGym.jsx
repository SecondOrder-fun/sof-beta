// src/routes/UIGym.jsx
// Development-only page showcasing all UI components
// This uses the actual production components so changes propagate automatically

import { useState } from 'react';
import PropTypes from 'prop-types';
import {
  ChevronDown,
  ChevronRight,
  Info,
  Loader2,
  Mail,
  Menu,
  Plus,
  Search,
  Settings,
  Trash,
  User,
  X,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';

// Import all UI components
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ContentBox, ImportantBox } from '@/components/ui/content-box';
import { Progress } from '@/components/ui/progress';
import MiniCurveChart from '@/components/curve/MiniCurveChart';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  CollapsibleItem,
} from '@/components/ui/collapsible';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Section wrapper component
const Section = ({ title, children }) => (
  <div className="mb-12">
    <h2 className="text-xl font-bold mb-2">{title}</h2>
    <Separator className="mb-4" />
    <div className="space-y-6">{children}</div>
  </div>
);

Section.propTypes = {
  title: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired,
};

// Subsection for grouping related variants
const Subsection = ({ title, children }) => (
  <div className="mb-6">
    <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
      {title}
    </h3>
    <div className="flex flex-wrap items-center gap-3">{children}</div>
  </div>
);

Subsection.propTypes = {
  title: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired,
};

const UIGym = () => {
  const [switchValue, setSwitchValue] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [selectValue, setSelectValue] = useState('');
  const [isCollapsibleOpen, setIsCollapsibleOpen] = useState(false);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background p-8">
        {/* Header */}
        <div className="max-w-6xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2">UI Gym</h1>
            <p className="text-muted-foreground">
              Component showcase for design system development. Changes here propagate to production.
            </p>
            <Badge variant="statusActive" className="mt-2">
              Development Only
            </Badge>
          </div>

          {/* Navigation */}
          <div className="mb-8 sticky top-0 bg-background/95 backdrop-blur py-4 z-10">
            <div className="flex flex-wrap gap-2 text-sm">
              {[
                'Buttons',
                'Inputs',
                'Display',
                'Overlays',
                'Navigation',
                'Data',
              ].map((section) => (
                <a
                  key={section}
                  href={`#${section.toLowerCase()}`}
                  className="px-3 py-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                >
                  {section}
                </a>
              ))}
            </div>
            <Separator className="mt-4" />
          </div>

          {/* Buttons Section */}
          <div id="buttons">
            <Section title="Buttons">
              <Subsection title="Variants">
                <Button variant="default">Default</Button>
                <Button variant="primary">Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="cancel">Cancel</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="link">Link</Button>
                <Button variant="destructive">Destructive</Button>
              </Subsection>

              <Subsection title="Sizes">
                <Button size="sm">Small</Button>
                <Button size="default">Default</Button>
                <Button size="lg">Large</Button>
              </Subsection>

              <Subsection title="Icon Only">
                <Button size="icon"><Search className="h-4 w-4" /></Button>
                <Button size="icon" variant="outline"><Search className="h-4 w-4" /></Button>
              </Subsection>

              <Subsection title="States">
                <Button disabled>Disabled</Button>
                <Button>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading
                </Button>
              </Subsection>

              <Subsection title="Button Group">
                <ButtonGroup>
                  <Button variant="outline" size="icon"><ChevronDown className="h-4 w-4 -rotate-90" /></Button>
                  <Button variant="outline" size="icon"><ChevronDown className="h-4 w-4 rotate-90" /></Button>
                </ButtonGroup>
                <ButtonGroup>
                  <Button variant="outline">Left</Button>
                  <Button variant="outline">Center</Button>
                  <Button variant="outline">Right</Button>
                </ButtonGroup>
              </Subsection>

              <Subsection title="With Icons">
                <Button>
                  <Mail className="mr-2 h-4 w-4" />
                  Login with Email
                </Button>
                <Button variant="outline">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Item
                </Button>
                <Button variant="destructive">
                  <Trash className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              </Subsection>
            </Section>
          </div>

          {/* Inputs Section */}
          <div id="inputs">
            <Section title="Inputs">
              <Subsection title="Text Input">
                <div className="w-64">
                  <Input
                    placeholder="Default input"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                  />
                </div>
                <div className="w-64">
                  <Input placeholder="Disabled" disabled />
                </div>
                <div className="w-64 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="With icon" className="pl-10" />
                </div>
              </Subsection>

              <Subsection title="Textarea">
                <div className="w-80">
                  <Textarea placeholder="Enter your message..." rows={3} />
                </div>
              </Subsection>

              <Subsection title="Select">
                <div className="w-48">
                  <Select value={selectValue} onValueChange={setSelectValue}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select option" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="option1">Option 1</SelectItem>
                      <SelectItem value="option2">Option 2</SelectItem>
                      <SelectItem value="option3">Option 3</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </Subsection>

              <Subsection title="Switch">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="switch-demo"
                    checked={switchValue}
                    onCheckedChange={setSwitchValue}
                  />
                  <Label htmlFor="switch-demo">
                    {switchValue ? 'Enabled' : 'Disabled'}
                  </Label>
                </div>
              </Subsection>

              <Subsection title="Label">
                <div className="grid w-64 gap-1.5">
                  <Label htmlFor="email-demo">Email</Label>
                  <Input id="email-demo" placeholder="you@example.com" />
                </div>
              </Subsection>
            </Section>
          </div>

          {/* Display Section */}
          <div id="display">
            <Section title="Display">
              <Subsection title="Badge Variants">
                <Badge variant="default">Default</Badge>
                <Badge variant="secondary">Secondary</Badge>
                <Badge variant="destructive">Destructive</Badge>
                <Badge variant="outline">Outline</Badge>
              </Subsection>

              <Subsection title="Badge Status">
                <Badge variant="statusActive">Active</Badge>
                <Badge variant="statusCompleted">Completed</Badge>
                <Badge variant="statusUpcoming">Upcoming</Badge>
                <Badge variant="statusDanger">Danger</Badge>
              </Subsection>

              <Subsection title="Avatar">
                <Avatar>
                  <AvatarImage src="https://github.com/shadcn.png" />
                  <AvatarFallback>CN</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarFallback>JD</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarFallback>
                    <User className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
              </Subsection>

              <Subsection title="Card">
                <Card className="w-80">
                  <CardHeader>
                    <CardTitle>Card Title</CardTitle>
                    <CardDescription>Card description goes here</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p>This is the card content area.</p>
                  </CardContent>
                  <CardFooter>
                    <Button size="sm">Action</Button>
                  </CardFooter>
                </Card>
              </Subsection>

              <Subsection title="Content Boxes">
                <div className="w-full max-w-md space-y-3">
                  <div className="flex gap-2">
                    <ContentBox className="flex-1">
                      <div className="text-xs text-muted-foreground mb-1">Current Price</div>
                      <div className="font-mono text-base">0.0042 SOF</div>
                    </ContentBox>
                    <ImportantBox className="flex-1">
                      <div className="text-xs text-primary-foreground/80 mb-1">Ends In</div>
                      <div className="font-bold text-base text-primary-foreground">2d 14h 32m</div>
                    </ImportantBox>
                  </div>
                  <ContentBox>
                    <div className="text-sm uppercase tracking-wide text-primary">Winner</div>
                    <div className="text-lg font-semibold text-foreground mt-1">vitalik.eth</div>
                    <div className="text-sm text-muted-foreground mt-1">Grand Prize: 12.50 SOF</div>
                  </ContentBox>
                  <ImportantBox>
                    <div className="text-primary-foreground font-bold text-lg text-center">Trading is Locked</div>
                    <div className="text-primary-foreground/80 text-sm mt-1 text-center">Raffle has ended</div>
                  </ImportantBox>
                </div>
              </Subsection>

              <Subsection title="Progress">
                <div className="w-full max-w-md space-y-5">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Default (h-4)</div>
                    <Progress value={65} />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Compact (h-2)</div>
                    <Progress value={42} className="h-2" />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">With labels</div>
                    <Progress value={80} className="h-2" />
                    <div className="flex justify-between text-xs text-muted-foreground mt-1">
                      <span>800 sold</span>
                      <span>1000 max</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">With step markers (bonding curve)</div>
                    <div className="flex justify-between text-sm text-primary mb-1">
                      <span>Bonding Curve Progress</span>
                      <span>35.00%</span>
                    </div>
                    <Progress
                      value={35}
                      className="h-3"
                      steps={[
                        { position: 10, label: "0.0010 SOF", sublabel: "Step #1" },
                        { position: 20, label: "0.0020 SOF", sublabel: "Step #2" },
                        { position: 30, label: "0.0030 SOF", sublabel: "Step #3" },
                        { position: 40, label: "0.0040 SOF", sublabel: "Step #4" },
                        { position: 50, label: "0.0050 SOF", sublabel: "Step #5" },
                        { position: 60, label: "0.0060 SOF", sublabel: "Step #6" },
                        { position: 70, label: "0.0070 SOF", sublabel: "Step #7" },
                        { position: 80, label: "0.0080 SOF", sublabel: "Step #8" },
                        { position: 90, label: "0.0090 SOF", sublabel: "Step #9" },
                      ]}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground mt-1">
                      <span>Supply: 35,000</span>
                      <span>100,000 max</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Empty / Full</div>
                    <div className="space-y-2">
                      <Progress value={0} className="h-2" />
                      <Progress value={100} className="h-2" />
                    </div>
                  </div>
                </div>
              </Subsection>

              <Subsection title="Mini Curve Chart">
                <p className="text-sm text-muted-foreground mb-3">
                  Recharts-based mini bonding curve. Fills container height responsively.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="border border-primary rounded-lg overflow-hidden h-40">
                    <MiniCurveChart
                      curveSupply={500n}
                      allBondSteps={[
                        { rangeTo: 100n, price: 1000000000000000000n, step: 1n },
                        { rangeTo: 300n, price: 2000000000000000000n, step: 2n },
                        { rangeTo: 600n, price: 3000000000000000000n, step: 3n },
                        { rangeTo: 1000n, price: 5000000000000000000n, step: 4n },
                      ]}
                    />
                  </div>
                  <div className="border border-primary rounded-lg overflow-hidden h-40">
                    <MiniCurveChart
                      curveSupply={0n}
                      allBondSteps={[
                        { rangeTo: 50n, price: 500000000000000000n, step: 1n },
                        { rangeTo: 150n, price: 1000000000000000000n, step: 2n },
                        { rangeTo: 300n, price: 1500000000000000000n, step: 3n },
                        { rangeTo: 500n, price: 2000000000000000000n, step: 4n },
                        { rangeTo: 750n, price: 3000000000000000000n, step: 5n },
                        { rangeTo: 1000n, price: 5000000000000000000n, step: 6n },
                      ]}
                    />
                  </div>
                </div>
                <div className="border border-primary rounded-lg overflow-hidden h-24 mt-4">
                  <MiniCurveChart
                    curveSupply={200n}
                    allBondSteps={[
                      { rangeTo: 250n, price: 1000000000000000000n, step: 1n },
                      { rangeTo: 500n, price: 4000000000000000000n, step: 2n },
                    ]}
                  />
                </div>
              </Subsection>

              <Subsection title="Alert Variants">
                <div className="w-full max-w-md space-y-3">
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertTitle>Default</AlertTitle>
                    <AlertDescription>
                      This is a default alert message.
                    </AlertDescription>
                  </Alert>
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>
                      Something went wrong. Please try again.
                    </AlertDescription>
                  </Alert>
                  <Alert variant="success">
                    <CheckCircle className="h-4 w-4" />
                    <AlertTitle>Success</AlertTitle>
                    <AlertDescription>
                      Your changes have been saved.
                    </AlertDescription>
                  </Alert>
                </div>
              </Subsection>

              <Subsection title="Skeleton">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-10 w-10 rounded-full" />
                </div>
              </Subsection>

              <Subsection title="Separator">
                <div className="w-64">
                  <p className="text-sm">Content above</p>
                  <Separator className="my-2" />
                  <p className="text-sm">Content below</p>
                </div>
              </Subsection>
            </Section>
          </div>

          {/* Overlays Section */}
          <div id="overlays">
            <Section title="Overlays">
              <Subsection title="Dialog">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline">Open Dialog</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Dialog Title</DialogTitle>
                      <DialogDescription>
                        This is a dialog description explaining what the dialog is for.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                      <p>Dialog content goes here.</p>
                    </div>
                    <DialogFooter>
                      <Button variant="cancel">Cancel</Button>
                      <Button>Confirm</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </Subsection>

              <Subsection title="Sheet">
                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="outline">Open Sheet</Button>
                  </SheetTrigger>
                  <SheetContent>
                    <SheetHeader>
                      <SheetTitle>Sheet Title</SheetTitle>
                      <SheetDescription>
                        Sheet slides in from the side.
                      </SheetDescription>
                    </SheetHeader>
                    <div className="py-4">
                      <p>Sheet content goes here.</p>
                    </div>
                  </SheetContent>
                </Sheet>
              </Subsection>

              <Subsection title="Popover">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline">Open Popover</Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80">
                    <div className="space-y-2">
                      <h4 className="font-medium">Popover Title</h4>
                      <p className="text-sm text-muted-foreground">
                        This is a popover with some content.
                      </p>
                    </div>
                  </PopoverContent>
                </Popover>
              </Subsection>

              <Subsection title="Tooltip">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline">Hover me</Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>This is a tooltip</p>
                  </TooltipContent>
                </Tooltip>
              </Subsection>

              <Subsection title="Dropdown Menu">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                      <Menu className="mr-2 h-4 w-4" />
                      Menu
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuLabel>My Account</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem>
                      <User className="mr-2 h-4 w-4" />
                      Profile
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Settings className="mr-2 h-4 w-4" />
                      Settings
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive">
                      <X className="mr-2 h-4 w-4" />
                      Logout
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </Subsection>
            </Section>
          </div>

          {/* Navigation Section */}
          <div id="navigation">
            <Section title="Navigation">
              <Subsection title="Tabs">
                <Tabs defaultValue="tab1" className="w-96">
                  <TabsList>
                    <TabsTrigger value="tab1">Account</TabsTrigger>
                    <TabsTrigger value="tab2">Password</TabsTrigger>
                    <TabsTrigger value="tab3">Settings</TabsTrigger>
                  </TabsList>
                  <TabsContent value="tab1" className="p-4 border rounded-md mt-2">
                    Account settings content
                  </TabsContent>
                  <TabsContent value="tab2" className="p-4 border rounded-md mt-2">
                    Password settings content
                  </TabsContent>
                  <TabsContent value="tab3" className="p-4 border rounded-md mt-2">
                    General settings content
                  </TabsContent>
                </Tabs>
              </Subsection>

              <Subsection title="Accordion">
                <Accordion type="single" collapsible className="w-96">
                  <AccordionItem value="item-1">
                    <AccordionTrigger>Is it accessible?</AccordionTrigger>
                    <AccordionContent>
                      Yes. It adheres to the WAI-ARIA design pattern.
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="item-2">
                    <AccordionTrigger>Is it styled?</AccordionTrigger>
                    <AccordionContent>
                      Yes. It comes with default styles that match your design system.
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="item-3">
                    <AccordionTrigger>Is it animated?</AccordionTrigger>
                    <AccordionContent>
                      Yes. It&apos;s animated by default with smooth transitions.
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </Subsection>

              <Subsection title="Collapsible">
                <Collapsible
                  open={isCollapsibleOpen}
                  onOpenChange={setIsCollapsibleOpen}
                  className="w-80"
                >
                  <div className="flex items-center justify-between space-x-4">
                    <h4 className="text-sm font-semibold">
                      @peduarte starred 3 repositories
                    </h4>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm">
                        {isCollapsibleOpen ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent className="space-y-2 mt-2">
                    <CollapsibleItem index={0} totalItems={3} className="rounded-md border px-4 py-2 text-sm">
                      @radix-ui/primitives
                    </CollapsibleItem>
                    <CollapsibleItem index={1} totalItems={3} className="rounded-md border px-4 py-2 text-sm">
                      @radix-ui/colors
                    </CollapsibleItem>
                    <CollapsibleItem index={2} totalItems={3} className="rounded-md border px-4 py-2 text-sm">
                      @stitches/react
                    </CollapsibleItem>
                  </CollapsibleContent>
                </Collapsible>
              </Subsection>
            </Section>
          </div>

          {/* Data Section */}
          <div id="data">
            <Section title="Data">
              <Subsection title="Table">
                <div className="w-full max-w-2xl">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-medium">INV001</TableCell>
                        <TableCell>
                          <Badge variant="statusCompleted">Paid</Badge>
                        </TableCell>
                        <TableCell>Credit Card</TableCell>
                        <TableCell className="text-right">$250.00</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium">INV002</TableCell>
                        <TableCell>
                          <Badge variant="statusActive">Pending</Badge>
                        </TableCell>
                        <TableCell>PayPal</TableCell>
                        <TableCell className="text-right">$150.00</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium">INV003</TableCell>
                        <TableCell>
                          <Badge variant="statusDanger">Unpaid</Badge>
                        </TableCell>
                        <TableCell>Bank Transfer</TableCell>
                        <TableCell className="text-right">$350.00</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </Subsection>
            </Section>
          </div>

          {/* Footer */}
          <div className="mt-16 py-8 border-t border-border text-center text-sm text-muted-foreground">
            <p>UI Gym - Development component showcase</p>
            <p className="mt-1">
              Components: Button, Input, Textarea, Switch, Select, Label, Badge, Avatar,
              Card, Alert, Skeleton, Separator, Dialog, Sheet, Popover, Tooltip,
              DropdownMenu, Tabs, Accordion, Collapsible, Table
            </p>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default UIGym;
