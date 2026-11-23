import type { BlockDefinition } from '../types';
import { Badge, Button, ButtonGroup, Card, Heading, Image, Text } from './basic';
import { EntryList } from './data';
import { Columns, Divider, Grid, Section, Spacer } from './layout';
import { CallToAction, FAQ, FeatureList, Hero } from './marketing';

/** Ready-made blocks styled with the OpenCloudCMS design tokens. Pass them to `defineBlocks` with your own. */
export const coreBlocks: BlockDefinition<any>[] = [
  Section, Columns, Grid, Spacer, Divider,
  Heading, Text, Image, Button, ButtonGroup, Card, Badge,
  Hero, FeatureList, CallToAction, FAQ,
  EntryList,
];
